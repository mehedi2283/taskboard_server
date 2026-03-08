import mongoose from 'mongoose';

const profileSchema = new mongoose.Schema({
  heroTitle: { type: String, default: "I'm Mehedi, I Design & Deploy Scalable Automation & AI Workflows." },
  heroSubtitle: { type: String, default: "Available for work" },
  navbarLogo: { type: String, default: "" },
  aboutText: { type: String, default: "I'm Mehedi Hasan, an Automation Engineer specializing in building workflow systems that connect APIs, CRMs, AI models, and SaaS tools into scalable business automation." },
  profileImage: { type: String, default: "" },
  email: { type: String, default: "" },
  socialLinks: {
    linkedin: { type: String, default: "" },
    facebook: { type: String, default: "" },
    instagram: { type: String, default: "" },
  },
  logos: [{
    name: { type: String, default: "" },
    imageUrl: { type: String, default: "" }
  }], // Array of tool logos
  clientLogos: [{
    name: { type: String, default: "" },
    imageUrl: { type: String, default: "" }
  }], // Array of client/company logos
  testimonialTimer: { type: Number, default: 5 }, // Seconds for random switch
}, { timestamps: true });

export const Profile = mongoose.model('Profile', profileSchema);
