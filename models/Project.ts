import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  imageUrl: { type: String, required: true },
  link: { type: String },
  tags: [{ type: String }],
  stats: [{ 
    label: { type: String }, 
    value: { type: String },
    description: { type: String }
  }],
  techLogos: [{ type: String }],
  order: { type: Number, default: 0 },
}, { timestamps: true });

export const Project = mongoose.model('Project', projectSchema);
