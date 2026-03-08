import express from 'express';
import { Profile } from '../models/Profile.ts';

const router = express.Router();

// Get profile
router.get('/', async (req, res) => {
  try {
    let profile = await Profile.findOne();
    if (!profile) {
      // Create default if not exists
      profile = new Profile({
        logos: []
      });
      await profile.save();
    }
    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update profile
router.put('/', async (req, res) => {
  try {
    let profile = await Profile.findOne();
    if (!profile) {
      profile = new Profile(req.body);
    } else {
      Object.assign(profile, req.body);
    }
    await profile.save();
    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
