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
        
        // Convert to trades format with new fields
        const trades = jsonData.map((row, index) => ({
            id: Date.now() + index,
            tradeId: row['Trade Id'] || `T${Date.now()}${index}`,
            tradingDate: row['Trading Date'] || new Date().toISOString().split('T')[0],
            openTime: row['Open Time'] || '',
            type: row.Type || 'crypto',
            pair: row.Pair || '',
            position: row.Position || 'Long',
            timeframe: row.Timeframe || '',
            riskPercentage: parseFloat(row['Risk%']) || 0,
            entryPrice: parseFloat(row['Entry Price']) || 0,
            stopLoss: parseFloat(row['Stop loss']) || null,
            takeProfit: parseFloat(row['Take Profit']) || null,
            closingDate: row['Closing Date'] || '',
            closeTime: row['Close Time'] || '',
            profitLoss: parseFloat(row['Profit/Loss']) || 0,
            chartImage: row['Chart Image'] || null,
            emotionBefore: row['Emotion Before'] || '',
            emotionAfter: row['Emotion After'] || '',
            notes: row.Notes || ''
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
// Fix for the /api/save route in server.js
// Replace the existing save route with this corrected version:

app.post('/api/save', (req, res) => {
    try {
        const { trades, startingBalanceCrypto, startingBalanceForex } = req.body;
        
        if (!activeFile.path) {
            return res.status(400).json({ error: 'No active file to save to. Please load a file first.' });
        }

        // Convert trades to Excel format with new fields
        const excelData = trades.map(trade => ({
            'Trade Id': trade.tradeId,
            'Trading Date': trade.tradingDate,
            'Open Time': trade.openTime,
            'Type': trade.type,
            'Pair': trade.pair,
            'Position': trade.position,
            'Timeframe': trade.timeframe,
            'Risk%': trade.riskPercentage,
            'Entry Price': trade.entryPrice,
            'Stop loss': trade.stopLoss || '',
            'Take Profit': trade.takeProfit || '',
            'Closing Date': trade.closingDate || '',
            'Close Time': trade.closeTime || '',
            'Profit/Loss': parseFloat(trade.profitLoss).toFixed(2),
            'Chart Image': trade.chartImage || '',
            'Emotion Before': trade.emotionBefore || '',
            'Emotion After': trade.emotionAfter || '',
            'Notes': trade.notes || ''
        }));

        // Calculate separated statistics using the correct variable names
        const cryptoTrades = trades.filter(trade => trade.type === 'crypto');
        const forexTrades = trades.filter(trade => trade.type === 'forex');
        
        const cryptoPnL = cryptoTrades.reduce((sum, trade) => sum + parseFloat(trade.profitLoss || 0), 0);
        const forexPnL = forexTrades.reduce((sum, trade) => sum + parseFloat(trade.profitLoss || 0), 0);
        
        const cryptoCurrentBalance = (startingBalanceCrypto || 10000) + cryptoPnL;
        const forexCurrentBalance = (startingBalanceForex || 10000) + forexPnL;
        const totalPortfolioValue = cryptoCurrentBalance + forexCurrentBalance;
        const totalPortfolioPnL = cryptoPnL + forexPnL;
        
        const cryptoWinningTrades = cryptoTrades.filter(trade => parseFloat(trade.profitLoss || 0) > 0).length;
        const forexWinningTrades = forexTrades.filter(trade => parseFloat(trade.profitLoss || 0) > 0).length;
        
        const cryptoWinRate = cryptoTrades.length > 0 ? (cryptoWinningTrades / cryptoTrades.length * 100).toFixed(1) : 0;
        const forexWinRate = forexTrades.length > 0 ? (forexWinningTrades / forexTrades.length * 100).toFixed(1) : 0;

        // Add summary rows
        excelData.push({
            'Trade Id': '',
            'Trading Date': '',
            'Open Time': '',
            'Type': 'CRYPTO SUMMARY',
            'Pair': '',
            'Position': '',
            'Timeframe': '',
            'Risk%': '',
            'Entry Price': '',
            'Stop loss': '',
            'Take Profit': '',
            'Closing Date': '',
            'Close Time': '',
            'Profit/Loss': cryptoPnL.toFixed(2),
            'Chart Image': '',
            'Emotion Before': '',
            'Emotion After': '',
            'Notes': `Starting: ${startingBalanceCrypto || 10000} | Current: ${cryptoCurrentBalance.toFixed(2)} | Win Rate: ${cryptoWinRate}% | Trades: ${cryptoTrades.length}`
        });

        excelData.push({
            'Trade Id': '',
            'Trading Date': '',
            'Open Time': '',
            'Type': 'FOREX SUMMARY',
            'Pair': '',
            'Position': '',
            'Timeframe': '',
            'Risk%': '',
            'Entry Price': '',
            'Stop loss': '',
            'Take Profit': '',
            'Closing Date': '',
            'Close Time': '',
            'Profit/Loss': forexPnL.toFixed(2),
            'Chart Image': '',
            'Emotion Before': '',
            'Emotion After': '',
            'Notes': `Starting: ${startingBalanceForex || 10000} | Current: ${forexCurrentBalance.toFixed(2)} | Win Rate: ${forexWinRate}% | Trades: ${forexTrades.length}`
        });

        excelData.push({
            'Trade Id': '',
            'Trading Date': '',
            'Open Time': '',
            'Type': 'PORTFOLIO SUMMARY',
            'Pair': '',
            'Position': '',
            'Timeframe': '',
            'Risk%': '',
            'Entry Price': '',
            'Stop loss': '',
            'Take Profit': '',
            'Closing Date': '',
            'Close Time': '',
            'Profit/Loss': totalPortfolioPnL.toFixed(2),
            'Chart Image': '',
            'Emotion Before': '',
            'Emotion After': '',
            'Notes': `Total Portfolio: ${totalPortfolioValue.toFixed(2)} | Total P&L: ${totalPortfolioPnL.toFixed(2)} | Total Trades: ${trades.length}`
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
// Fix for the /api/create-new route in server.js
// Replace the existing create-new route with this corrected version:

app.post('/api/create-new', (req, res) => {
    try {
        const { fileName, trades, startingBalanceCrypto, startingBalanceForex } = req.body;
        
        if (!fileName) {
            return res.status(400).json({ error: 'File name is required' });
        }

        // Ensure .xlsx extension
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fullFileName = sanitizedFileName.endsWith('.xlsx') ? sanitizedFileName : `${sanitizedFileName}.xlsx`;
        const filePath = path.join(uploadsDir, fullFileName);

        // Convert trades to Excel format with new fields
        const excelData = trades.map(trade => ({
            'Trade Id': trade.tradeId,
            'Trading Date': trade.tradingDate,
            'Open Time': trade.openTime,
            'Type': trade.type,
            'Pair': trade.pair,
            'Position': trade.position,
            'Timeframe': trade.timeframe,
            'Risk%': trade.riskPercentage,
            'Entry Price': trade.entryPrice,
            'Stop loss': trade.stopLoss || '',
            'Take Profit': trade.takeProfit || '',
            'Closing Date': trade.closingDate || '',
            'Close Time': trade.closeTime || '',
            'Profit/Loss': parseFloat(trade.profitLoss || 0).toFixed(2),
            'Chart Image': trade.chartImage || '',
            'Emotion Before': trade.emotionBefore || '',
            'Emotion After': trade.emotionAfter || '',
            'Notes': trade.notes || ''
        }));

        // Add balance configuration row with correct variable names
        excelData.push({
            'Trade Id': '',
            'Trading Date': '',
            'Open Time': '',
            'Type': 'BALANCE CONFIG',
            'Pair': '',
            'Position': '',
            'Timeframe': '',
            'Risk%': '',
            'Entry Price': '',
            'Stop loss': '',
            'Take Profit': '',
            'Closing Date': '',
            'Close Time': '',
            'Profit/Loss': '',
            'Chart Image': '',
            'Emotion Before': '',
            'Emotion After': '',
            'Notes': `Crypto Starting: ${startingBalanceCrypto || 10000} | Forex Starting: ${startingBalanceForex || 10000}`
        });

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
        
        // Filter out summary rows and extract balance config if present
        let startingBalanceCrypto = 10000;
        let startingBalanceForex = 10000;
        
        const balanceConfigRow = jsonData.find(row => row.Type === 'BALANCE CONFIG');
        if (balanceConfigRow && balanceConfigRow.Notes) {
            const balanceMatch = balanceConfigRow.Notes.match(/Crypto Starting: ([\d.]+).*Forex Starting: ([\d.]+)/);
            if (balanceMatch) {
                startingBalanceCrypto = parseFloat(balanceMatch[1]);
                startingBalanceForex = parseFloat(balanceMatch[2]);
            }
        }
        
        const filteredData = jsonData.filter(row => 
            row.Type !== 'SUMMARY' && 
            row.Type !== 'CRYPTO SUMMARY' && 
            row.Type !== 'FOREX SUMMARY' && 
            row.Type !== 'PORTFOLIO SUMMARY' && 
            row.Type !== 'BALANCE CONFIG'
        );
        
        // Store as active file
        activeFile = {
            path: filePath,
            originalName: fileName,
            data: filteredData
        };
        
        // Convert to trades format with new fields
        const trades = filteredData.map((row, index) => ({
            id: Date.now() + index,
            tradeId: row['Trade Id'] || `T${Date.now()}${index}`,
            tradingDate: row['Trading Date'] || new Date().toISOString().split('T')[0],
            openTime: row['Open Time'] || '',
            type: row.Type || 'crypto',
            pair: row.Pair || '',
            position: row.Position || 'Long',
            timeframe: row.Timeframe || '',
            riskPercentage: parseFloat(row['Risk%']) || 0,
            entryPrice: parseFloat(row['Entry Price']) || 0,
            stopLoss: parseFloat(row['Stop loss']) || null,
            takeProfit: parseFloat(row['Take Profit']) || null,
            closingDate: row['Closing Date'] || '',
            closeTime: row['Close Time'] || '',
            profitLoss: parseFloat(row['Profit/Loss']) || 0,
            chartImage: row['Chart Image'] || null,
            emotionBefore: row['Emotion Before'] || '',
            emotionAfter: row['Emotion After'] || '',
            notes: row.Notes || ''
        }));

        res.json({
            success: true,
            message: 'File loaded successfully',
            fileName: fileName,
            trades: trades,
            startingBalanceCrypto: startingBalanceCrypto,
            startingBalanceForex: startingBalanceForex
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