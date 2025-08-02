const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Create charts directory for storing chart images
const chartsDir = path.join(__dirname, 'uploads', 'charts');
if (!fs.existsSync(chartsDir)) {
    fs.mkdirSync(chartsDir, { recursive: true });
}

// Configure multer for Excel/CSV uploads
const excelStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const originalName = file.originalname;
        cb(null, `${timestamp}_${originalName}`);
    }
});

// Configure multer for chart image uploads
const chartStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/charts/');
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substr(2, 9);
        const fileExt = path.extname(file.originalname).toLowerCase();
        cb(null, `chart_${timestamp}_${randomId}${fileExt}`);
    }
});

const uploadExcel = multer({ 
    storage: excelStorage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.xlsx', '.xls', '.csv'];
        const fileExt = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(fileExt)) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel and CSV files are allowed'));
        }
    }
});

const uploadChart = multer({
    storage: chartStorage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const fileExt = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(fileExt)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Store active file information
let activeFile = {
    path: null,
    originalName: null,
    data: []
};

// Routes

// Upload and load Excel/CSV file
app.post('/api/upload', uploadExcel.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const filePath = req.file.path;
        const originalName = req.file.originalname;
        
        // Read the uploaded file
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        // Store active file info
        activeFile = {
            path: filePath,
            originalName: originalName,
            data: jsonData
        };
        
        // Convert to trades format
        const trades = jsonData.map((row, index) => ({
            id: Date.now() + index,
            type: row.Type || 'crypto',
            pair: row.Pair || '',
            side: row.Side || 'Long',
            entryPrice: parseFloat(row['Entry Price']) || 0,
            exitPrice: parseFloat(row['Exit Price']) || 0,
            quantity: parseFloat(row.Quantity) || 0,
            leverage: parseFloat(row.Leverage) || 1,
            stopLoss: parseFloat(row['Stop Loss']) || 0,
            takeProfit: parseFloat(row['Take Profit']) || 0,
            slPoints: parseFloat(row['SL Points']) || 0,
            tpPoints: parseFloat(row['TP Points']) || 0,
            date: row.Date || new Date().toLocaleDateString(),
            notes: row.Notes || '',
            chartImage: row['Chart Image'] || null, // Load chart image path
            pnl: parseFloat(row['P&L']) || 0
        }));

        res.json({
            success: true,
            message: 'File loaded successfully',
            fileName: originalName,
            trades: trades
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Error processing file: ' + error.message });
    }
});

// Save trades to the currently active file
app.post('/api/save', (req, res) => {
    try {
        const { trades, startingBalance } = req.body;
        
        if (!activeFile.path) {
            return res.status(400).json({ error: 'No active file to save to. Please load a file first.' });
        }

        // Convert trades to Excel format
        const excelData = trades.map(trade => ({
            'Date': trade.date,
            'Type': trade.type,
            'Pair': trade.pair,
            'Side': trade.side,
            'Entry Price': trade.entryPrice,
            'Exit Price': trade.exitPrice,
            'Quantity': trade.quantity,
            'Leverage': trade.leverage,
            'Stop Loss': trade.stopLoss || '',
            'Take Profit': trade.takeProfit || '',
            'SL Points': trade.slPoints || '',
            'TP Points': trade.tpPoints || '',
            'P&L': parseFloat(trade.pnl).toFixed(2),
            'Chart Image': trade.chartImage || '',
            'Notes': trade.notes
        }));

        // Add summary row
        const totalPnL = trades.reduce((sum, trade) => sum + parseFloat(trade.pnl), 0);
        const currentBalance = startingBalance + totalPnL;
        const winningTrades = trades.filter(trade => parseFloat(trade.pnl) > 0).length;
        const winRate = trades.length > 0 ? (winningTrades / trades.length * 100).toFixed(1) : 0;

        excelData.push({
            'Date': '',
            'Type': 'SUMMARY',
            'Pair': '',
            'Side': '',
            'Entry Price': '',
            'Exit Price': '',
            'Quantity': '',
            'Leverage': '',
            'Stop Loss': '',
            'Take Profit': '',
            'SL Points': '',
            'TP Points': '',
            'P&L': totalPnL.toFixed(2),
            'Chart Image': '',
            'Notes': `Starting: ${startingBalance} | Current: ${currentBalance.toFixed(2)} | Win Rate: ${winRate}% | Total Trades: ${trades.length}`
        });

        // Create new workbook and worksheet
        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Trading Journal');

        // Save to the original file location
        XLSX.writeFile(wb, activeFile.path);

        // Update active file data
        activeFile.data = excelData;

        res.json({
            success: true,
            message: `File "${activeFile.originalName}" updated successfully`,
            fileName: activeFile.originalName
        });

    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ error: 'Error saving file: ' + error.message });
    }
});

// Upload chart image
app.post('/api/upload-chart', uploadChart.single('chart'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No chart image uploaded' });
        }

        const chartPath = `/api/chart/${req.file.filename}`;
        
        res.json({
            success: true,
            chartPath: chartPath,
            fileName: req.file.filename
        });

    } catch (error) {
        console.error('Chart upload error:', error);
        res.status(500).json({ error: 'Error uploading chart: ' + error.message });
    }
});

// Serve chart images
app.get('/api/chart/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(chartsDir, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Chart image not found' });
        }
        
        res.sendFile(filePath);
    } catch (error) {
        console.error('Chart serve error:', error);
        res.status(500).json({ error: 'Error serving chart image' });
    }
});

// Delete chart image
app.delete('/api/chart/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(chartsDir, filename);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        res.json({ success: true, message: 'Chart deleted successfully' });
    } catch (error) {
        console.error('Chart delete error:', error);
        res.status(500).json({ error: 'Error deleting chart' });
    }
});

// Create new Excel file
app.post('/api/create-new', (req, res) => {
    try {
        const { fileName, trades, startingBalance } = req.body;
        
        if (!fileName) {
            return res.status(400).json({ error: 'File name is required' });
        }

        // Ensure .xlsx extension
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fullFileName = sanitizedFileName.endsWith('.xlsx') ? sanitizedFileName : `${sanitizedFileName}.xlsx`;
        const filePath = path.join(uploadsDir, fullFileName);

        // Convert trades to Excel format
        const excelData = trades.map(trade => ({
            'Date': trade.date,
            'Type': trade.type,
            'Pair': trade.pair,
            'Side': trade.side,
            'Entry Price': trade.entryPrice,
            'Exit Price': trade.exitPrice,
            'Quantity': trade.quantity,
            'Leverage': trade.leverage,
            'Stop Loss': trade.stopLoss || '',
            'Take Profit': trade.takeProfit || '',
            'SL Points': trade.slPoints || '',
            'TP Points': trade.tpPoints || '',
            'P&L': parseFloat(trade.pnl).toFixed(2),
            'Notes': trade.notes
        }));

        // Create workbook and worksheet
        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Trading Journal');

        // Save file
        XLSX.writeFile(wb, filePath);

        // Set as active file
        activeFile = {
            path: filePath,
            originalName: fullFileName,
            data: excelData
        };

        res.json({
            success: true,
            message: `New file "${fullFileName}" created successfully`,
            fileName: fullFileName
        });

    } catch (error) {
        console.error('Create file error:', error);
        res.status(500).json({ error: 'Error creating file: ' + error.message });
    }
});

// Download the currently active file
app.get('/api/download', (req, res) => {
    try {
        if (!activeFile.path || !fs.existsSync(activeFile.path)) {
            return res.status(404).json({ error: 'No active file to download' });
        }

        res.download(activeFile.path, activeFile.originalName, (err) => {
            if (err) {
                console.error('Download error:', err);
                res.status(500).json({ error: 'Error downloading file' });
            }
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Error downloading file: ' + error.message });
    }
});

// Get active file info
app.get('/api/active-file', (req, res) => {
    res.json({
        hasActiveFile: !!activeFile.path,
        fileName: activeFile.originalName || null
    });
});

// List all files in uploads directory
app.get('/api/files', (req, res) => {
    try {
        const files = fs.readdirSync(uploadsDir)
            .filter(file => ['.xlsx', '.xls', '.csv'].includes(path.extname(file).toLowerCase()))
            .map(file => ({
                name: file,
                path: path.join(uploadsDir, file),
                size: fs.statSync(path.join(uploadsDir, file)).size,
                modified: fs.statSync(path.join(uploadsDir, file)).mtime
            }))
            .sort((a, b) => b.modified - a.modified);

        res.json(files);
    } catch (error) {
        console.error('List files error:', error);
        res.status(500).json({ error: 'Error listing files: ' + error.message });
    }
});

// Load specific file by name
app.post('/api/load-file', (req, res) => {
    try {
        const { fileName } = req.body;
        const filePath = path.join(uploadsDir, fileName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Read the file
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        // Filter out summary rows
        const filteredData = jsonData.filter(row => row.Type !== 'SUMMARY');
        
        // Store as active file
        activeFile = {
            path: filePath,
            originalName: fileName,
            data: filteredData
        };
        
        // Convert to trades format
        const trades = filteredData.map((row, index) => ({
            id: Date.now() + index,
            type: row.Type || 'crypto',
            pair: row.Pair || '',
            side: row.Side || 'Long',
            entryPrice: parseFloat(row['Entry Price']) || 0,
            exitPrice: parseFloat(row['Exit Price']) || 0,
            quantity: parseFloat(row.Quantity) || 0,
            leverage: parseFloat(row.Leverage) || 1,
            stopLoss: parseFloat(row['Stop Loss']) || 0,
            takeProfit: parseFloat(row['Take Profit']) || 0,
            slPoints: parseFloat(row['SL Points']) || 0,
            tpPoints: parseFloat(row['TP Points']) || 0,
            date: row.Date || new Date().toLocaleDateString(),
            notes: row.Notes || '',
            chartImage: row['Chart Image'] || null,
            pnl: parseFloat(row['P&L']) || 0
        }));

        res.json({
            success: true,
            message: 'File loaded successfully',
            fileName: fileName,
            trades: trades
        });

    } catch (error) {
        console.error('Load file error:', error);
        res.status(500).json({ error: 'Error loading file: ' + error.message });
    }
});

// Delete file
app.delete('/api/files/:fileName', (req, res) => {
    try {
        const fileName = req.params.fileName;
        const filePath = path.join(uploadsDir, fileName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        // If it's the active file, clear active file
        if (activeFile.originalName === fileName) {
            activeFile = { path: null, originalName: null, data: [] };
        }

        fs.unlinkSync(filePath);
        
        res.json({
            success: true,
            message: `File "${fileName}" deleted successfully`
        });

    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'Error deleting file: ' + error.message });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
    }
    res.status(500).json({ error: error.message });
});

// Start server
app.listen(PORT, () => {
    console.log(`Trading Journal Server running on http://localhost:${PORT}`);
    console.log(`Uploads directory: ${uploadsDir}`);
});

module.exports = app;