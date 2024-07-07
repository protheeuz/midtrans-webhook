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

    // Lakukan validasi payload dan cek status pembayaran
    if (event.transaction_status === 'settlement') {
        // Pembayaran berhasil
        const orderId = event.order_id;
        const phoneNumber = event.customer_details.phone; // Ambil nomor telepon dari detail pelanggan
        const customerName = event.customer_details.first_name; // Ambil nama pelanggan

        // Kirim notifikasi WhatsApp
        sendWhatsAppNotification(orderId, phoneNumber, customerName)
            .then(response => {
                console.log('WhatsApp notification sent:', response.data);
                res.status(200).send('Notification sent');
            })
            .catch(error => {
                console.error('Error sending WhatsApp notification:', error.response ? error.response.data : error.message);
                res.status(500).send('Error sending notification');
            });
    } else {
        console.log('Event received but not settlement:', event.transaction_status);
        res.status(200).send('Event received');
    }
});

function sendWhatsAppNotification(orderId, phoneNumber, customerName) {
    const apiUrl = 'https://wapisender.id/api/v5/message/text';
    const message = `Halo, ${customerName}, pembayaran untuk order ${orderId} berhasil. Terima kasih atas pembelian Anda.`;

    const data = new FormData();
    data.append('api_key', WAPISENDER_API_KEY);
    data.append('device_key', WAPISENDER_DEVICE_KEY);
    data.append('destination', phoneNumber);
    data.append('message', message);

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