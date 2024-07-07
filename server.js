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

const connectToDatabase = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
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
        const newOrder = new Order({ orderId, phoneNumber, customerName, email, grossAmount });
        await newOrder.save();

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

        const transaction = await snap.createTransaction(parameter);
        const paymentUrl = transaction.redirect_url;

        newOrder.paymentUrl = paymentUrl;
        await newOrder.save();

        sendWhatsAppNotification(orderId, phoneNumber, customerName, paymentUrl)
            .then(response => {
                console.log('WhatsApp notification sent:', response.data);
                res.status(200).send('Order created and notification sent');
            })
            .catch(error => {
                console.error('Error sending WhatsApp notification:', error.response ? error.response.data : error.message);
                res.status(500).send('Error sending notification');
            });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).send('Error creating order');
    }
});

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

        let statusResponse;
        try {
            const apiClient = new midtransClient.Snap({
                isProduction: false,
                serverKey: MIDTRANS_SERVER_KEY,
                clientKey: MIDTRANS_CLIENT_KEY
            });
            statusResponse = await apiClient.transaction.notification(event);
        } catch (err) {
            console.error('Error getting transaction status:', err);
            return res.status(500).send('Error getting transaction status');
        }

        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        if (transactionStatus === 'capture') {
            if (fraudStatus === 'accept') {
                order.paymentStatus = 'success';
                await order.save();
                sendWhatsAppNotification(orderId, order.phoneNumber, order.customerName, 'settlement')
                    .then(response => {
                        console.log('WhatsApp notification sent:', response.data);
                        res.status(200).send('Notification sent');
                    })
                    .catch(error => {
                        console.error('Error sending WhatsApp notification:', error.response ? error.response.data : error.message);
                        res.status(500).send('Error sending notification');
                    });
            }
        } else if (transactionStatus === 'settlement') {
            order.paymentStatus = 'success';
            await order.save();
            sendWhatsAppNotification(orderId, order.phoneNumber, order.customerName, 'settlement')
                .then(response => {
                    console.log('WhatsApp notification sent:', response.data);
                    res.status(200).send('Notification sent');
                })
                .catch(error => {
                    console.error('Error sending WhatsApp notification:', error.response ? error.response.data : error.message);
                    res.status(500).send('Error sending notification');
                });
        } else if (transactionStatus === 'pending') {
            order.paymentStatus = 'pending';
            await order.save();
            res.status(200).send('Pending event received');
        } else if (transactionStatus === 'cancel' || transactionStatus === 'deny' || transactionStatus === 'expire') {
            order.paymentStatus = 'failure';
            await order.save();
            sendWhatsAppNotification(orderId, order.phoneNumber, order.customerName, 'expire')
                .then(response => {
                    console.log('WhatsApp notification sent:', response.data);
                    res.status(200).send('Notification sent');
                })
                .catch(error => {
                    console.error('Error sending WhatsApp notification:', error.response ? error.response.data : error.message);
                    res.status(500).send('Error sending notification');
                });
        } else {
            console.log('Unhandled transaction status:', transactionStatus);
            res.status(200).send('Event received but not handled');
        }
    } catch (error) {
        console.error('Error handling webhook:', error);
        res.status(500).send('Error handling webhook');
    }
});

app.get('/payment/finish', (req, res) => {
    res.send('Pembayaran berhasil. Terima kasih atas pembelian Anda!');
});

app.get('/payment/unfinish', (req, res) => {
    res.send('Pembayaran belum selesai. Silakan selesaikan pembayaran Anda.');
});

app.get('/payment/error', (req, res) => {
    res.send('Terjadi kesalahan pada pembayaran. Silakan coba lagi.');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});