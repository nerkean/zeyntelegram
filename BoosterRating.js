const mongoose = require('mongoose');

const boosterRatingSchema = new mongoose.Schema({

  boosterId: { type: String, required: true, unique: true },
  ratings: {
    '1': { type: Number, default: 0 },
    '2': { type: Number, default: 0 },
    '3': { type: Number, default: 0 },
    '4': { type: Number, default: 0 },
    '5': { type: Number, default: 0 }
  },
  totalRatings: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  ratedBy: { type: [String], default: [] },
  comments: [{
    userId: String,
    orderId: String,
    comment: String
  }]
});

const BoosterRating = mongoose.model('BoosterRating', boosterRatingSchema);

module.exports = BoosterRating; 