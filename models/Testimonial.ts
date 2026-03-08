import mongoose from 'mongoose';

const testimonialSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: { type: String, required: true },
  avatar: { type: String, default: "" },
  content: { type: String, required: true },
  color: { type: String, default: "#4F46E5" },
  rating: { type: Number, default: 5 },
}, { timestamps: true });

export const Testimonial = mongoose.model('Testimonial', testimonialSchema);
