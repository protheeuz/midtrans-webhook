const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');
const path = require('path');
const connectToDatabase = require('./mongodb');
const verifyMidtrans = require('./middleware/verifyMidtrans');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const WAPISENDER_API_KEY = process.env.WAPISENDER_API_KEY;
const WAPISENDER_DEVICE_KEY = process.env.WAPISENDER_DEVICE_KEY;
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/assets', express.static(path.join(__dirname, 'assets'))); // Menyajikan aset statis
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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

app.get('/', (req, res) => {
    res.render('index');
});

app.post('/create-payment-link', async (req, res) => {
    const { customerName, phoneNumber, email, grossAmount } = req.body;
    const orderId = 'order-' + new Date().getTime();

    try {
        const newOrder = new Order({ orderId, phoneNumber, customerName, email, grossAmount });
        await newOrder.save();

        const response = await axios.post('https://app.sandbox.midtrans.com/snap/v1/transactions', {
            transaction_details: {
                order_id: orderId,
                gross_amount: grossAmount
            },
            customer_details: {
                first_name: customerName,
                email: email,
                phone: phoneNumber
            }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64')
            }
        });

        const paymentUrl = response.data.redirect_url;

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

app.post('/webhook', verifyMidtrans, async (req, res) => {
    const event = req.body;

    console.log('Received event:', JSON.stringify(event, null, 2));

    switch (event.transaction_status) {
        case 'capture':
        case 'settlement':
            handleSettlement(event, res);
            break;
        case 'pending':
            handlePending(event, res);
            break;
        case 'expire':
            handleExpire(event, res);
            break;
        default:
            console.log('Unhandled transaction status:', event.transaction_status);
            res.status(200).send('Event received but not handled');
    }
});

async function handleSettlement(event, res) {
    const orderId = event.order_id;
    try {
        const order = await Order.findOne({ orderId });
        if (!order) {
            console.error('Order not found for orderId', orderId);
            return res.status(404).send('Order not found');
        }

        order.paymentStatus = 'settlement';
        await order.save();

        const phoneNumber = order.phoneNumber;
        const customerName = order.customerName || 'Pelanggan';

        console.log(`Preparing to send WhatsApp notification for order ${orderId} to ${phoneNumber}`);

        sendWhatsAppNotification(orderId, phoneNumber, customerName, 'settlement')
            .then(response => {
                console.log('WhatsApp notification sent:', response.data);
                res.status(200).send('Notification sent');
            })
            .catch(error => {
                console.error('Error sending WhatsApp notification:', error.response ? error.response.data : error.message);
                res.status(500).send('Error sending notification');
            });
    } catch (error) {
        console.error('Error handling settlement:', error);
        res.status(500).send('Error handling settlement');
    }
}

async function handlePending(event, res) {
    const orderId = event.order_id;
    try {
        const order = await Order.findOne({ orderId });
        if (!order) {
            console.error('Order not found for orderId', orderId);
            return res.status(404).send('Order not found');
        }

        order.paymentStatus = 'pending';
        await order.save();

        const phoneNumber = order.phoneNumber;
        const customerName = order.customerName || 'Pelanggan';

        console.log(`Transaction pending for order ${orderId}`);

        sendWhatsAppNotification(orderId, phoneNumber, customerName, 'pending')
            .then(response => {
                console.log('WhatsApp notification sent for pending transaction:', response.data);
                res.status(200).send('Notification sent for pending transaction');
            })
            .catch(error => {
                console.error('Error sending WhatsApp notification for pending transaction:', error.response ? error.response.data : error.message);
                res.status(500).send('Error sending notification for pending transaction');
            });
    } catch (error) {
        console.error('Error handling pending:', error);
        res.status(500).send('Error handling pending');
    }
}

async function handleExpire(event, res) {
    const orderId = event.order_id;
    try {
        const order = await Order.findOne({ orderId });
        if (!order) {
            console.error('Order not found for orderId', orderId);
            return res.status(404).send('Order not found');
        }

        order.paymentStatus = 'expire';
        await order.save();

        const phoneNumber = order.phoneNumber;
        const customerName = order.customerName || 'Pelanggan';

        console.log(`Transaction expired for order ${orderId}`);

        sendWhatsAppNotification(orderId, phoneNumber, customerName, 'expire')
            .then(response => {
                console.log('WhatsApp notification sent for expired transaction:', response.data);
                res.status(200).send('Notification sent for expired transaction');
            })
            .catch(error => {
                console.error('Error sending WhatsApp notification for expired transaction:', error.response ? error.response.data : error.message);
                res.status(500).send('Error sending notification for expired transaction');
            });
    } catch (error) {
        console.error('Error handling expire:', error);
        res.status(500).send('Error handling expire');
    }
}

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
    });
}

app.post('/wapisender-webhook', (req, res) => {
    const event = req.body;

    console.log('Received Wapisender webhook:', JSON.stringify(event, null, 2));

    const hash = crypto.createHash('md5').update(`${event.device_key}#${WAPISENDER_API_KEY}#${event.message_id}`).digest('hex');
    if (hash === event.hash) {
        console.log('Hash verified successfully.');
    } else {
        console.log('Hash verification failed.');
    }

    res.status(200).send('Webhook received');
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