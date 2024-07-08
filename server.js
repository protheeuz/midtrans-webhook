const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');
const path = require('path');
const midtransClient = require('midtrans-client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const WAPISENDER_API_KEY = process.env.WAPISENDER_API_KEY;
const WAPISENDER_DEVICE_KEY = process.env.WAPISENDER_DEVICE_KEY;
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Koneksi ke MongoDB
const connectToDatabase = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
};

connectToDatabase();

const orderSchema = new mongoose.Schema({
    orderId: String,
    phoneNumber: String,
    customerName: String,
    email: String,
    grossAmount: Number,
    paymentUrl: String,
    paymentStatus: { type: String, default: 'pending' }
});

const Order = mongoose.model('Order', orderSchema);

const snap = new midtransClient.Snap({
    isProduction: false, // Ganti menjadi true jika Anda ingin menggunakan Production Environment
    serverKey: MIDTRANS_SERVER_KEY
});

app.get('/', (req, res) => {
    res.render('index');
});

app.post('/create-payment-link', async (req, res) => {
    const { customerName, phoneNumber, email, grossAmount } = req.body;
    const orderId = 'order-' + new Date().getTime();

    try {
        console.log('Creating new order...');
        const newOrder = new Order({ orderId, phoneNumber, customerName, email, grossAmount });
        await newOrder.save();
        console.log('New order saved.');

        let parameter = {
            transaction_details: {
                order_id: orderId,
                gross_amount: grossAmount
            },
            customer_details: {
                first_name: customerName,
                email: email,
                phone: phoneNumber
            }
        };

        console.log('Creating transaction with Midtrans...');
        const transaction = await snap.createTransaction(parameter);
        const paymentUrl = transaction.redirect_url;
        console.log('Transaction created. Payment URL:', paymentUrl);

        newOrder.paymentUrl = paymentUrl;
        await newOrder.save();
        console.log('Order updated with payment URL.');

        sendWhatsAppNotification(orderId, phoneNumber, customerName, paymentUrl)
            .then(response => {
                console.log('WhatsApp notification sent:', response.data);
                res.status(200).send('Order created and notification sent');
            })
            .catch(error => {
                if (error.response) {
                    console.error('Error response data:', error.response.data);
                } else {
                    console.error('Error message:', error.message);
                }
                res.status(500).send('Error sending notification');
            });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).send('Error creating order');
    }
});

function sendWhatsAppNotification(orderId, phoneNumber, customerName, statusOrPaymentUrl) {
    const apiUrl = 'https://wapisender.id/api/v5/message/text';
    let message = '';

    if (statusOrPaymentUrl === 'settlement') {
        message = `✅ Halo, ${customerName}, pembayaran untuk order ${orderId} berhasil. Terima kasih atas pembelian Anda.`;
    } else if (statusOrPaymentUrl === 'pending') {
        message = `⌛ Halo, ${customerName}, pembayaran untuk order ${orderId} sedang menunggu konfirmasi. Silakan selesaikan pembayaran Anda.`;
    } else if (statusOrPaymentUrl === 'expire') {
        message = `⚠️ Halo, ${customerName}, pembayaran untuk order ${orderId} telah kedaluwarsa. Silakan coba lagi.`;
    } else {
        message = `📝 Halo, ${customerName}, silakan selesaikan pembayaran Anda dengan mengunjungi tautan berikut: ${statusOrPaymentUrl}`;
    }

    const data = new FormData();
    data.append('api_key', WAPISENDER_API_KEY);
    data.append('device_key', WAPISENDER_DEVICE_KEY);
    data.append('destination', phoneNumber);
    data.append('message', message);

    console.log(`Sending WhatsApp notification to ${phoneNumber}: ${message}`);

    return axios.post(apiUrl, data, {
        headers: data.getHeaders()
    }).then(response => {
        console.log('WhatsApp notification sent:', response.data);
        return response.data;
    }).catch(error => {
        if (error.response) {
            console.error('Error response data:', error.response.data);
        } else {
            console.error('Error message:', error.message);
        }
        throw new Error('Error sending WhatsApp notification');
    });
}

app.post('/webhook', async (req, res) => {
    const event = req.body;

    console.log('Received event:', JSON.stringify(event, null, 2));

    const orderId = event.order_id;
    try {
        const order = await Order.findOne({ orderId });
        if (!order) {
            console.error('Order not found for orderId', orderId);
            return res.status(404).send('Order not found');
        }

        console.log('Processing event with status:', event.transaction_status);

        if (event.transaction_status === 'capture' || event.transaction_status === 'settlement') {
            order.paymentStatus = 'settlement';
            await order.save();
            console.log('Order status updated to settlement.');
            sendWhatsAppNotification(orderId, order.phoneNumber, order.customerName, 'settlement')
                .then(response => {
                    console.log('WhatsApp notification sent:', response.data);
                    res.status(200).send('Notification sent');
                })
                .catch(error => {
                    if (error.response) {
                        console.error('Error response data:', error.response.data);
                    } else {
                        console.error('Error message:', error.message);
                    }
                    res.status(500).send('Error sending notification');
                });
        } else if (event.transaction_status === 'pending') {
            order.paymentStatus = 'pending';
            await order.save();
            console.log('Order status updated to pending.');
            sendWhatsAppNotification(orderId, order.phoneNumber, order.customerName, 'pending')
                .then(response => {
                    console.log('WhatsApp notification sent for pending:', response.data);
                    res.status(200).send('Pending notification sent');
                })
                .catch(error => {
                    if (error.response) {
                        console.error('Error response data:', error.response.data);
                    } else {
                        console.error('Error message:', error.message);
                    }
                    res.status(500).send('Error sending pending notification');
                });
        } else if (event.transaction_status === 'expire') {
            order.paymentStatus = 'expire';
            await order.save();
            console.log('Order status updated to expire.');
            sendWhatsAppNotification(orderId, order.phoneNumber, order.customerName, 'expire')
                .then(response => {
                    console.log('WhatsApp notification sent:', response.data);
                    res.status(200).send('Notification sent');
                })
                .catch(error => {
                    if (error.response) {
                        console.error('Error response data:', error.response.data);
                    } else {
                        console.error('Error message:', error.message);
                    }
                    res.status(500).send('Error sending notification');
                });
        } else {
            console.log('Unhandled transaction status:', event.transaction_status);
            res.status(200).send('Event received but not handled');
        }
    } catch (error) {
        console.error('Error handling webhook:', error);
        res.status(500).send('Error handling webhook');
    }
});

app.get('/payment-status/:orderId', async (req, res) => {
    const { orderId } = req.params;
    try {
        const order = await Order.findOne({ orderId });
        if (!order) {
            return res.status(404).send('Order not found');
        }
        res.status(200).json({
            orderId: order.orderId,
            paymentStatus: order.paymentStatus,
            paymentUrl: order.paymentUrl
        });
    } catch (error) {
        console.error('Error retrieving order status:', error);
        res.status(500).send('Error retrieving order status');
    }
});

// Endpoint untuk menguji koneksi MongoDB
app.get('/test-mongodb', async (req, res) => {
    try {
        const connection = await mongoose.connection;
        if (connection.readyState === 1) {
            res.status(200).send('Connected to MongoDB');
        } else {
            res.status(500).send('Failed to connect to MongoDB');
        }
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        res.status(500).send('Error connecting to MongoDB');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});