const crypto = require('crypto');
require('dotenv').config();

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;

const verifyMidtrans = (req, res, next) => {
    const signatureKey = req.headers['x-callback-signature'] || req.body.signature_key;
    const orderId = req.body.order_id;
    const statusCode = req.body.status_code;
    const grossAmount = req.body.gross_amount;
    const serverKey = Buffer.from(MIDTRANS_SERVER_KEY).toString('base64');

    const mySignature = crypto.createHash('sha512').update(orderId + statusCode + grossAmount + serverKey).digest('hex');

    if (mySignature === signatureKey) {
        next();
    } else {
        res.status(403).send('Unauthorized');
    }
};

module.exports = verifyMidtrans;