import express from 'express';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB Schema Definitions
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' }, // 'superadmin', 'project_manager', 'team_leader', 'team_member', 'user'
  department: { type: String },
  status: { type: String, default: 'pending' }, // 'active', 'pending', 'rejected'
  googleSheetId: { type: String },
  googleCredentials: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const taskSchema = new mongoose.Schema({
  date: String,
  projectName: String,
  description: String,
  priority: String,
  startTime: String,
  dueTime: String,
  status: String,
  assignedPerson: [String],
  category: String,
  timeSpent: Number,
  notes: String,
  id: { type: String, unique: true, sparse: true }, // Frontend UUID
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());

  // Request logger (BEFORE body-parser to catch errors)
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    }
    next();
  });

  app.use(express.json({ limit: '200mb' }));
  app.use(express.urlencoded({ limit: '200mb', extended: true }));

  // Root route for UptimeRobot and general ping
  app.get('/', (_req, res) => {
    console.log('GET /');
    res.send('Backend API is running');
  });

  // Connect to MongoDB
  const MONGODB_URI = process.env.MONGODB_URI;

  try {
    console.log('Attempting to connect to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    console.error('Hint: Check if your IP address is whitelisted in MongoDB Atlas Network Access.');
    console.error('Hint: Ensure your username and password are correct.');
  }

  const cleanKey = (key?: string) => {
    if (!key) return null;
    let cleaned = key.trim();
    cleaned = cleaned.replace(/\\n/g, '\n').replace(/^"(.*)"$/, '$1').replace(/'/g, '');
    if (!cleaned.includes('-----BEGIN PRIVATE KEY-----')) return null;
    return cleaned;
  };

  // Google Sheets Auth (Default from Env)
  // Google Sheets Auth
  const getAuth = (email?: string, key?: string, jsonCredentials?: string) => {
    try {
      // 1. If JSON credentials provided (entire file pasted in settings)
      if (jsonCredentials) {
        try {
          const creds = JSON.parse(jsonCredentials);
          if (creds.client_email && creds.private_key) {
            console.log('Using parsed JSON credentials for auth');
            return new google.auth.JWT({
              email: creds.client_email,
              key: creds.private_key,
              scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
          }
        } catch (je) {
          // Not valid JSON, fall back
        }
      }

      // 2. Fallback to discrete email/key
      const formattedKey = cleanKey(key);
      if (!email || !formattedKey) return null;

      return new google.auth.JWT({
        email,
        key: formattedKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } catch (e: any) {
      console.error('Auth Initialization Error:', e.message);
      return null;
    }
  };

  const defaultAuth = getAuth(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, process.env.GOOGLE_PRIVATE_KEY);
  const sheets = google.sheets({ version: 'v4', auth: defaultAuth || undefined });

  // Robust Sheet Sync Helper
  const syncToSheet = async (userId: string, tasksToSync: any[] = [], isFullSync: boolean = false) => {
    if (!userId || tasksToSync.length === 0) return;

    try {
      const user = await User.findById(userId);
      if (!user) {
        console.log(`[Sync] User ${userId} not found`);
        return;
      }

      if (!user.googleSheetId) {
        console.log(`[Sync] User ${user.email} has no googleSheetId configured. Skipping sync.`);
        return;
      }

      console.log(`[Sync] Starting ${isFullSync ? 'FULL' : 'INCREMENTAL'} sync for user ${user.email} to sheet ${user.googleSheetId}`);

      // Robust Sheet ID extraction from URL if needed
      const spreadsheetId = user.googleSheetId.includes('/d/')
        ? user.googleSheetId.split('/d/')[1].split('/')[0]
        : user.googleSheetId.trim();

      // Prioritize user-provided credentials from DB, then fall back to ENV
      const userAuth = getAuth(
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        process.env.GOOGLE_PRIVATE_KEY,
        user.googleCredentials
      );

      if (!userAuth) {
        console.error(`[Sync] Authentication failed: No valid credentials for user ${user.email}`);
        return;
      }

      const userSheets = google.sheets({ version: 'v4', auth: userAuth });

      if (isFullSync) {
        // Clear existing data from row 2 downward
        try {
          await userSheets.spreadsheets.values.clear({
            spreadsheetId,
            range: 'Sheet1!A2:L',
          });
          console.log(`[Sync] Cleared existing data in Sheet1!A2:L for full sync.`);
        } catch (clearErr: any) {
          console.log(`[Sync] Note: Could not clear existing data (might be empty already).`);
        }

        const rows = tasksToSync.map(t => [
          t.date || '',
          t.projectName || '',
          t.description || '',
          t.priority || '',
          t.startTime || '',
          t.dueTime || '',
          t.status || '',
          (t.assignedPerson || []).join(', '),
          t.category || '',
          t.timeSpent || 0,
          t.notes || '',
          t.id || (t._id ? t._id.toString() : '')
        ]);

        try {
          console.log(`[Sync] Attempting to append all ${rows.length} rows to ${spreadsheetId}`);
          await userSheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Sheet1!A2',
            valueInputOption: 'RAW',
            requestBody: { values: rows },
          });
          console.log(`[Sync] SUCCESS: Appended ${rows.length} rows to sheet ${spreadsheetId}`);
        } catch (sheetError: any) {
          console.error(`[Sync] Google Sheets API Error: ${sheetError.message}`);
          if (sheetError.message.includes('not found')) {
            console.error(`[Sync] Hint: Check if the spreadsheet ID is correct and shared with the service account email.`);
          } else if (sheetError.message.includes('permission')) {
            console.error(`[Sync] Hint: Ensure the service account has Editor access to the sheet.`);
          }
        }
      } else {
        // Incremental sync
        let existingValues: any[][] = [];
        try {
          const getRes = await userSheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sheet1!A:L',
          });
          existingValues = getRes.data.values || [];
        } catch (err: any) {
          console.log(`[Sync] Could not fetch existing sheet data to find duplicates.`);
        }

        for (const t of tasksToSync) {
          const taskId = t.id || (t._id ? t._id.toString() : '');

          let rowIndex = -1;
          for (let i = 0; i < existingValues.length; i++) {
            if (existingValues[i] && existingValues[i][11] === taskId) {
              rowIndex = i + 1; // Google sheets rows are 1-indexed
              break;
            }
          }

          if (t._deleted) {
            if (rowIndex !== -1) {
              try {
                await userSheets.spreadsheets.values.clear({
                  spreadsheetId,
                  range: `Sheet1!A${rowIndex}:L${rowIndex}`
                });
                console.log(`[Sync] SUCCESS: Cleared row ${rowIndex} (Task deleted).`);
              } catch (e) { }
            }
            continue;
          }

          const rowData = [
            t.date || '',
            t.projectName || '',
            t.description || '',
            t.priority || '',
            t.startTime || '',
            t.dueTime || '',
            t.status || '',
            (t.assignedPerson || []).join(', '),
            t.category || '',
            t.timeSpent || 0,
            t.notes || '',
            taskId
          ];

          try {
            if (rowIndex !== -1) {
              await userSheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Sheet1!A${rowIndex}:L${rowIndex}`,
                valueInputOption: 'RAW',
                requestBody: { values: [rowData] }
              });
              console.log(`[Sync] SUCCESS: Updated row ${rowIndex} for task ${taskId}.`);
            } else {
              await userSheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Sheet1!A2',
                valueInputOption: 'RAW',
                requestBody: { values: [rowData] }
              });
              console.log(`[Sync] SUCCESS: Appended new row for task ${taskId}.`);
            }
          } catch (sheetError: any) {
            console.error(`[Sync] Error updating/appending task: ${sheetError.message}`);
          }
        }
      }
    } catch (error: any) {
      console.error('[Sync] Unexpected error during sync process:', error.message);
    }
  };

  // Robust Sheet ID extraction
  const rawSheetId = process.env.GOOGLE_SHEET_ID || '';
  const SPREADSHEET_ID = rawSheetId.includes('/d/')
    ? rawSheetId.split('/d/')[1].split('/')[0]
    : rawSheetId.trim();

  const RANGE = 'Sheet1!A2:L';

  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret', (err: any, user: any) => {
      if (err) {
        console.log(`Auth Failed: ${err.message}`);
        return res.sendStatus(403);
      }
      req.user = user;
      next();
    });
  };

  // Helper to serialize task for frontend
  const serializeTask = (task: any) => {
    const t = task.toObject ? task.toObject() : task;
    return {
      ...t,
      id: (t._id || t.id)?.toString()
    };
  };

  // API Routes

  // --- Task CRUD Endpoints ---

  // Get all tasks for user
  app.get('/api/tasks', authenticateToken, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const tasks = await Task.find({ userId }).sort({ createdAt: -1 });
      res.json(tasks);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk sync all tasks to Google Sheet
  app.post('/api/tasks/sync-all', authenticateToken, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const tasks = await Task.find({ userId }).sort({ createdAt: 1 });

      if (tasks.length === 0) {
        return res.json({ success: true, message: 'No tasks to sync' });
      }

      console.log(`[Sync All] User ${userId} requested full sync of ${tasks.length} tasks`);

      // Trigger sync (awaiting this one to provide feedback to UI)
      await syncToSheet(userId, tasks, true);

      res.json({ success: true, count: tasks.length });
    } catch (error: any) {
      console.error('[Sync All] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Create a single task
  app.post('/api/tasks', authenticateToken, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const taskData = req.body;

      const task = new Task({ ...taskData, userId });
      await task.save();

      // Trigger background sync to sheet
      syncToSheet(userId, [task]);

      res.status(201).json(serializeTask(task));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update a single task
  app.patch('/api/tasks/:id', authenticateToken, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const taskId = req.params.id;
      const updates = req.body;

      console.log(`PATCH /api/tasks/${taskId} for user ${userId}`);

      if (!taskId || taskId === 'undefined') {
        return res.status(400).json({ error: 'Invalid task ID' });
      }

      // Match by custom id OR MongoDB _id
      let filter: any = {
        userId: new mongoose.Types.ObjectId(userId)
      };

      if (mongoose.Types.ObjectId.isValid(taskId)) {
        filter.$or = [{ _id: new mongoose.Types.ObjectId(taskId) }, { id: taskId }];
      } else {
        filter.id = taskId;
      }

      console.log('Filter:', JSON.stringify(filter));

      const task = await Task.findOneAndUpdate(filter, updates, { new: true, returnDocument: 'after' });
      if (!task) {
        console.log(`[404] Task ${taskId} not found for user ${userId}`);
        return res.status(404).json({ error: 'Task not found' });
      }

      // Trigger background sync to sheet
      syncToSheet(userId, [task]);

      console.log(`[200] Task ${taskId} updated successfully`);
      res.json(serializeTask(task));
    } catch (error: any) {
      console.error('[500] Update task error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a single task
  app.delete('/api/tasks/:id', authenticateToken, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const taskId = req.params.id;

      console.log(`DELETE /api/tasks/${taskId} for user ${userId}`);

      if (!taskId || taskId === 'undefined') {
        return res.status(400).json({ error: 'Invalid task ID' });
      }

      let filter: any = {
        userId: new mongoose.Types.ObjectId(userId)
      };

      if (mongoose.Types.ObjectId.isValid(taskId)) {
        filter.$or = [{ _id: new mongoose.Types.ObjectId(taskId) }, { id: taskId }];
      } else {
        filter.id = taskId;
      }

      const result = await Task.deleteOne(filter);
      if (result.deletedCount === 0) {
        console.log(`[404] Task ${taskId} not found for deletion`);
        return res.status(404).json({ error: 'Task not found' });
      }

      // Trigger background sync for delete
      syncToSheet(userId, [{ id: taskId, _deleted: true }]);

      console.log(`[200] Task ${taskId} deleted successfully`);
      res.json({ success: true });
    } catch (error: any) {
      console.error('[500] Delete task error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk sync
  app.post('/api/sync', authenticateToken, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { tasks } = req.body;

      if (Array.isArray(tasks)) {
        for (const taskData of tasks) {
          const { id, _id, ...updateData } = taskData;
          const targetId = id || _id;

          let filter: any = { userId };
          if (targetId && mongoose.Types.ObjectId.isValid(targetId)) {
            filter.$or = [{ _id: targetId }, { id: targetId }];
          } else if (targetId) {
            filter.id = targetId;
          }

          await Task.findOneAndUpdate(
            filter,
            { ...updateData, id: targetId, userId },
            { upsert: true }
          );
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/tasks/cleanup', authenticateToken, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const result = await Task.deleteMany({
        userId,
        $or: [
          { projectName: '', description: '' },
          { projectName: { $exists: false }, description: { $exists: false } },
          { projectName: 'Project', description: 'Task...' }
        ]
      });
      res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Auth Routes
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { email, password, role, department } = req.body;

      // Check if user exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: 'User already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      const user = new User({
        email,
        password: hashedPassword,
        role: role || 'user',
        department,
        status: 'pending' // Default to pending approval
      });

      await user.save();

      const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'your_jwt_secret');
      res.json({ token, user: { id: user._id, email: user.email, role: user.role, department: user.department, status: user.status } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });

      if (!user) {
        return res.status(400).json({ error: 'User not found' });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(400).json({ error: 'Invalid password' });
      }

      const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'your_jwt_secret');
      res.json({ token, user: { id: user._id, email: user.email, role: user.role, department: user.department, status: user.status } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/auth/me', authenticateToken, async (req: any, res) => {
    try {
      const user = await User.findById(req.user.id).select('-password');
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/auth/impersonate/:id', authenticateToken, async (req: any, res) => {
    try {
      const currentUser = req.user;
      if (currentUser.role !== 'superadmin' && currentUser.role !== 'project_manager') {
        return res.status(403).json({ error: 'Unauthorized to impersonate' });
      }

      const targetUser = await User.findById(req.params.id);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      const token = jwt.sign({ id: targetUser._id, email: targetUser.email, role: targetUser.role }, process.env.JWT_SECRET || 'your_jwt_secret');
      res.json({ token, user: { id: targetUser._id, email: targetUser.email, role: targetUser.role, department: targetUser.department, status: targetUser.status } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/users/settings', authenticateToken, async (req: any, res) => {
    try {
      const { googleSheetId, googleCredentials } = req.body;
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (googleSheetId !== undefined) user.googleSheetId = googleSheetId;
      if (googleCredentials !== undefined) user.googleCredentials = googleCredentials;

      await user.save();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/users', authenticateToken, async (req: any, res) => {
    try {
      const currentUser = req.user;
      let query: any = {};

      if (currentUser.role === 'team_leader') {
        query.department = currentUser.department;
      } else if (currentUser.role !== 'superadmin' && currentUser.role !== 'project_manager') {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const users = await User.find(query).select('-password');
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/users/:id/status', authenticateToken, async (req: any, res) => {
    try {
      const { status } = req.body;
      const userId = req.params.id;
      const currentUser = req.user;

      // Check permissions
      const targetUser = await User.findById(userId);
      if (!targetUser) return res.status(404).json({ error: 'User not found' });

      if (currentUser.role === 'team_leader') {
        if (targetUser.department !== currentUser.department || targetUser.role !== 'team_member') {
          return res.status(403).json({ error: 'Unauthorized' });
        }
      } else if (currentUser.role !== 'superadmin' && currentUser.role !== 'project_manager') {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      targetUser.status = status;
      await targetUser.save();
      res.json(targetUser);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/users/:id/role', authenticateToken, async (req: any, res) => {
    try {
      const { role } = req.body;
      const userId = req.params.id;
      const currentUser = req.user;

      if (currentUser.role !== 'superadmin') {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const targetUser = await User.findById(userId);
      if (!targetUser) return res.status(404).json({ error: 'User not found' });

      targetUser.role = role;
      await targetUser.save();
      res.json(targetUser);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/departments/taken', async (req, res) => {
    try {
      const users = await User.find({ role: 'team_leader', status: { $in: ['active', 'pending'] } }).select('department');
      const takenDepartments = users.map(u => u.department).filter(Boolean);
      res.json({ takenDepartments });
    } catch (error: any) {
      console.error('Error fetching taken departments:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Catch-all unhandled routes
  app.use((req, res) => {
    console.log(`Unhandled Request: ${req.method} ${req.path}`);
    res.status(404).send(`Cannot ${req.method} ${req.path}`);
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Global Error Handler:', err.message);
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    res.status(500).json({ error: 'Internal server error' });
  });
}

startServer();
