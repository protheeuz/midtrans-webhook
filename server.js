const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 3000;

// Menggunakan variabel lingkungan
const WAPISENDER_API_KEY = process.env.WAPISENDER_API_KEY;
const WAPISENDER_DEVICE_KEY = process.env.WAPISENDER_DEVICE_KEY;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Endpoint untuk menerima notifikasi dari Midtrans
app.post('/webhook', (req, res) => {
    const event = req.body;

    // Simpan log untuk debugging
    console.log('Received event:', JSON.stringify(event, null, 2));

    switch (event.transaction_status) {
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

function handleSettlement(event, res) {
    const orderId = event.order_id;
    const phoneNumber = event.customer_details.phone; // Ambil nomor telepon dari detail pelanggan
    const customerName = event.customer_details.first_name; // Ambil nama pelanggan

    console.log(`Preparing to send WhatsApp notification for order ${orderId} to ${phoneNumber}`);

    // Kirim notifikasi WhatsApp
    sendWhatsAppNotification(orderId, phoneNumber, customerName, 'settlement')
        .then(response => {
            console.log('WhatsApp notification sent:', response.data);
            res.status(200).send('Notification sent');
        })
        .catch(error => {
            console.error('Error sending WhatsApp notification:', error.response ? error.response.data : error.message);
            res.status(500).send('Error sending notification');
        });
}

function handlePending(event, res) {
    const orderId = event.order_id;
    const phoneNumber = event.customer_details.phone;
    const customerName = event.customer_details.first_name;

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
}

function handleExpire(event, res) {
    const orderId = event.order_id;
    const phoneNumber = event.customer_details.phone;
    const customerName = event.customer_details.first_name;

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
}

function sendWhatsAppNotification(orderId, phoneNumber, customerName, status) {
    const apiUrl = 'https://wapisender.id/api/v5/message/text';
    let message = '';

    if (status === 'settlement') {
        message = `✅ Halo, ${customerName}, pembayaran untuk order ${orderId} berhasil. Terima kasih atas pembelian Anda.`;
    } else if (status === 'pending') {
        message = `⌛ Halo, ${customerName}, pembayaran untuk order ${orderId} sedang menunggu konfirmasi. Silakan selesaikan pembayaran Anda.`;
    } else if (status === 'expire') {
        message = `⚠️ Halo, ${customerName}, pembayaran untuk order ${orderId} telah kedaluwarsa. Silakan coba lagi.`;
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

// Endpoint untuk menerima webhook dari Wapisender (opsional jika Anda ingin menangani pesan masuk)
app.post('/wapisender-webhook', (req, res) => {
    const event = req.body;

    // Simpan log untuk debugging
    console.log('Received Wapisender webhook:', JSON.stringify(event, null, 2));

    // Verifikasi hash untuk memastikan webhook berasal dari Wapisender
    const hash = crypto.createHash('md5').update(`${event.device_key}#${WAPISENDER_API_KEY}#${event.message_id}`).digest('hex');
    if (hash === event.hash) {
        console.log('Hash verified successfully.');
        // Tangani logika setelah pesan dikirim
    } else {
        console.log('Hash verification failed.');
    }

    res.status(200).send('Webhook received');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});