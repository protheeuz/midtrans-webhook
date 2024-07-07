const crypto = require('crypto');
require('dotenv').config();

const verifyMidtrans = (req, res, next) => {
    const signatureKey = req.body.signature_key;
    const orderId = req.body.order_id;
    const statusCode = req.body.status_code;
    const grossAmount = req.body.gross_amount;

    const hash = crypto.createHash('sha512').update(orderId + statusCode + grossAmount + process.env.MIDTRANS_SERVER_KEY).digest('hex');

    if (hash === signatureKey) {
        return next();
    } else {
        res.status(403).send('Forbidden: Invalid signature');
    }
};

module.exports = verifyMidtrans;