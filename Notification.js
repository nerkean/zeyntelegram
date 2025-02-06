const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  type: { type: String, required: true }, // Тип уведомления: 'confirmed', 'cancelled', 'rated', 'reviewed'
  orderId: { type: String, required: true },
  rating: { type: Number }, // Оценка (если есть)
  review: { type: String }, // Отзыв (если есть)
  processed: { type: Boolean, default: false }, // Обработано ли уведомление (Discord ботом)
  createdAt: { type: Date, default: Date.now },
});

const Notification = mongoose.model("Notification", notificationSchema);

module.exports = Notification;