const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String, required: true },
  customerId: { type: String, required: true },
  boosterId: { type: String },
  status: { type: String, required: true, default: 'Ожидает выполнения' },
  customerName: { type: String },
  channelMessageId: { type: String }, 
  rating: { type: Number },
  dmMessageId: { type: String }, 
  customerAvatarURL: { type: String, required: true },
  source: { type: String, required: true, default: 'telegram' }
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;