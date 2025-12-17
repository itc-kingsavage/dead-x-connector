# 💀 DEAD-X-BOT Session Scanner

A web-based WhatsApp session scanner that generates unique session IDs and stores them securely in MongoDB. Built for seamless deployment on Render with the DEAD-X-BOT ecosystem.

## 🚀 Features

- ✅ **Web-based QR Scanner** - No terminal access needed
- ✅ **Real-time Updates** - Socket.io for instant QR code delivery
- ✅ **MongoDB Storage** - Persistent, encrypted session data
- ✅ **Unique Session IDs** - Format: `DEADX-XXXXXXXX`
- ✅ **RESTful API** - Easy integration with main bot
- ✅ **Auto-expiry** - Sessions automatically expire after 7 days
- ✅ **Render Optimized** - Pre-configured for one-click deployment

## 📋 Prerequisites

- Node.js 18+ 
- MongoDB Atlas account (free tier works)
- Render account (for deployment)
- WhatsApp account

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/dead-x-bot-scanner.git
cd dead-x-bot-scanner
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create `.env` file from template:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/deadxbot
ENCRYPTION_KEY=your-32-char-encryption-key-here
SESSION_SECRET=your-secret-key
ALLOWED_ORIGINS=http://localhost:3000
```

### 4. Run Locally

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

Visit `http://localhost:3000`

## 🌐 Deploy to Render

### Option 1: One-Click Deploy

1. Fork this repository
2. Go to [Render Dashboard](https://dashboard.render.com/)
3. Click **New +** → **Web Service**
4. Connect your GitHub repository
5. Render will auto-detect `render.yaml`
6. Add your `MONGODB_URI` in environment variables
7. Click **Create Web Service**

### Option 2: Manual Deploy

1. Create new Web Service on Render
2. Connect repository
3. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
4. Add environment variables from `.env.example`
5. Deploy

## 📖 Usage

### For End Users (Scanning)

1. Visit your deployed scanner URL
2. Click **"Start Scanning"**
3. Scan the QR code with WhatsApp
4. Copy your unique Session ID
5. Use Session ID in DEAD-X-BOT deployment

### For Bot Developers (Integration)

#### Fetch Session from Scanner API

```javascript
const SESSION_ID = process.env.SESSION_ID; // e.g., DEADX-ABC12345

// Fetch session data
const response = await fetch(
  `https://your-scanner.onrender.com/session/${SESSION_ID}`
);

const { session } = await response.json();

if (session.status === 'active') {
  // Use session.data to initialize WhatsApp client
  console.log('Phone:', session.phoneNumber);
  console.log('Session valid until:', session.expiresAt);
}
```

#### Initialize WhatsApp Client with Session

```javascript
const { Client, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: SESSION_ID
  })
});

// Client will use stored session - no QR needed!
await client.initialize();
```

## 🔌 API Endpoints

### Scanning Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/scan` | Display QR scanning page |
| `POST` | `/scan/start` | Initialize new session |
| `GET` | `/scan/status/:id` | Check scan status |
| `GET` | `/scan/success/:id` | Success page with session ID |

### Session Management Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/session/:id` | Retrieve session data |
| `GET` | `/session/validate/:id` | Validate if session is active |
| `DELETE` | `/session/:id` | Delete/revoke session |
| `GET` | `/session/list/all` | List all active sessions |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Server health status |

## 📁 Project Structure

```
DEAD-X-BOT-SESSION-SCANNER/
├── src/
│   ├── config/
│   │   ├── database.js          # MongoDB connection
│   │   └── whatsapp.js          # WhatsApp config
│   ├── models/
│   │   └── Session.js           # Session schema
│   ├── services/
│   │   └── sessionManager.js    # Session management
│   ├── routes/
│   │   ├── scan.js              # Scanning routes
│   │   └── session.js           # Session API routes
│   └── public/
│       ├── css/
│       │   └── style.css        # Styling
│       └── js/
│           └── scanner.js       # Frontend logic
├── views/
│   ├── index.ejs                # Landing page
│   ├── scan.ejs                 # QR scanning page
│   ├── success.ejs              # Success page
│   └── error.ejs                # Error page
├── .env.example                 # Environment template
├── .gitignore
├── package.json
├── render.yaml                  # Render config
├── server.js                    # Main entry point
└── README.md
```

## 🔒 Security Features

- **Encrypted Storage**: Session data encrypted with AES
- **Auto-expiry**: Sessions expire after 7 days
- **CORS Protection**: Configurable allowed origins
- **Input Validation**: All inputs validated and sanitized
- **Secure Headers**: Security headers configured
- **No Plaintext Storage**: Authentication tokens never stored in plaintext

## 🐛 Troubleshooting

### QR Code Not Appearing

```bash
# Check if Puppeteer/Chromium installed correctly
npm list puppeteer

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### MongoDB Connection Failed

```bash
# Verify MongoDB URI format
mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>

# Check IP whitelist in MongoDB Atlas
# Add 0.0.0.0/0 to allow all IPs (for Render)
```

### Session Not Persisting

```bash
# Ensure .wwebjs_auth folder exists and is writable
mkdir .wwebjs_auth

# Check file permissions
chmod -R 755 .wwebjs_auth
```

### Render Deployment Issues

1. **Build fails**: Check Node version in `render.yaml` (must be 18+)
2. **Service won't start**: Check logs in Render dashboard
3. **QR not loading**: Ensure Chromium dependencies installed
4. **MongoDB timeout**: Whitelist Render IPs in MongoDB Atlas

## 📊 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | No | development | Environment mode |
| `MONGODB_URI` | **Yes** | - | MongoDB connection string |
| `ENCRYPTION_KEY` | **Yes** | - | 32-char encryption key |
| `SESSION_SECRET` | **Yes** | - | Session secret key |
| `ALLOWED_ORIGINS` | No | * | CORS allowed origins |
| `SESSION_EXPIRY` | No | 7d | Session expiration time |

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📝 License

This project is licensed under the MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) - WhatsApp Web API
- [Socket.io](https://socket.io/) - Real-time communication
- [Mongoose](https://mongoosejs.com/) - MongoDB ODM
- [Express](https://expressjs.com/) - Web framework

## 📧 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/dead-x-bot-scanner/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/dead-x-bot-scanner/discussions)

---

**Made with ❤️ for the DEAD-X-BOT Community**
