import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
    id: { type: String, unique: true, sparse: true }, // Frontend UUID
    description: String
});

const Task = mongoose.model('TaskTest', taskSchema);

async function run() {
    await mongoose.connect('mongodb://127.0.0.1:27017/task-board');

    // Try finding a task to see what t.id returns
    const task = await Task.findOne();
    if (task) {
        console.log("Found task:");
        console.log("task._id:", task._id);
        console.log("task.id:", task.id);
        console.log("task.get('id'):", task.get('id'));
    } else {
        // create one
        const newTask = new Task({ id: "aaa94c62-be39-498c-a6bb-775c33fe65b5", description: "testing" });
        await newTask.save();
        console.log("Created task:");
        console.log("task._id:", newTask._id);
        console.log("task.id:", newTask.id);
        console.log("task.get('id'):", newTask.get('id'));
    }

    process.exit(0);
}

run();
