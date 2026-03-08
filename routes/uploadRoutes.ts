import express from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const IMGBB_API_KEY = '0dfba9f982c03fb77410bf4d22445cfd';

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const formData = new FormData();
    formData.append('image', req.file.buffer.toString('base64'));

    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    if (response.data && response.data.data && response.data.data.url) {
      res.json({ url: response.data.data.url });
    } else {
      res.status(500).json({ message: 'Failed to upload to ImgBB' });
    }
  } catch (error) {
    console.error('ImgBB upload error:', error);
    res.status(500).json({ message: 'Upload failed' });
  }
});

export default router;
