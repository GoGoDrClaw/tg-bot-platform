# Development Mode - Authentication Bypass

For local development, Bot Platform supports bypassing Telegram authentication to speed up the development workflow.

## 🚀 Quick Start

Add to your `.env`:

```env
DEV_BYPASS_AUTH=true
DEV_USER_TELEGRAM_ID=123456789
DEV_USER_USERNAME=devuser
DEV_USER_FIRST_NAME=Dev
DEV_USER_LAST_NAME=User
```

Restart the server, open http://localhost:3000/login.html, and click **🔧 Dev Login (Skip Auth)**.

## 🔒 Security

Dev mode is **automatically disabled** if:
- ✅ `NODE_ENV=production`
- ✅ Request is not from localhost (127.0.0.1)
- ✅ `DEV_BYPASS_AUTH` is not explicitly set to `true`

**Warning banner** is shown in the UI when dev mode is active.

## 📋 How It Works

### Backend

1. **Endpoint:** `POST /auth/dev-login`
2. **Checks:**
   - NODE_ENV !== production
   - DEV_BYPASS_AUTH === true
   - Request from localhost
3. **Creates/finds** dev user with configured Telegram ID
4. **Returns** JWT token (same as real auth)

### Frontend

1. **Login page** checks `/auth/check` for `devBypassEnabled`
2. If enabled, shows **"Dev Login"** button
3. On click, calls `/auth/dev-login`
4. Saves token and redirects to main page
5. Shows **warning banner** in UI

## 🎨 Visual Indicators

### Login Page
```
┌─────────────────────────────────┐
│   Bot Platform                  │
│   [Telegram Login Widget]       │
│                                 │
│   ────────── or ──────────      │
│                                 │
│   [ 🔧 Dev Login (Skip Auth) ]  │
│   ⚠️ Development mode           │
└─────────────────────────────────┘
```

### Main Page
```
┌─────────────────────────────────────────┐
│ ⚠️ DEVELOPMENT MODE - Auth bypassed     │
├─────────────────────────────────────────┤
│ bot-platform   [Dev User] [Logout]     │
│ ...                                     │
```

## ⚙️ Configuration

### Environment Variables

```env
# Enable dev bypass (default: false)
DEV_BYPASS_AUTH=true

# Dev user Telegram ID (default: 123456789)
DEV_USER_TELEGRAM_ID=123456789

# Dev user username (default: devuser)
DEV_USER_USERNAME=devuser

# Dev user first name (default: Dev)
DEV_USER_FIRST_NAME=Dev

# Dev user last name (default: User)
DEV_USER_LAST_NAME=User
```

### Customize Dev User

Use your real Telegram ID to test admin features:

```env
# Get your Telegram ID from @userinfobot
DEV_USER_TELEGRAM_ID=987654321
DEV_USER_USERNAME=myusername
DEV_USER_FIRST_NAME=John
DEV_USER_LAST_NAME=Doe
```

## 🧪 Testing Real Auth

To test real Telegram authentication while dev mode is enabled:

1. **Option A:** Comment out `DEV_BYPASS_AUTH` in `.env`
2. **Option B:** Use incognito/private window (dev login won't show)
3. **Option C:** Set `DEV_BYPASS_AUTH=false` temporarily

## 🐛 Troubleshooting

### "Dev login only available in development mode"

**Cause:** `NODE_ENV=production` or `DEV_BYPASS_AUTH` not set

**Solution:**
```env
NODE_ENV=development  # or remove this line
DEV_BYPASS_AUTH=true
```

### "Dev login only available from localhost"

**Cause:** Request from non-localhost IP

**Solution:** Access via http://localhost:3000 or http://127.0.0.1:3000

### Dev login button not showing

**Cause:** Backend not returning `devBypassEnabled: true`

**Solution:**
1. Check `.env` has `DEV_BYPASS_AUTH=true`
2. Restart server
3. Check browser console for errors
4. Verify `/auth/check` returns `{ devBypassEnabled: true }`

### Warning banner not showing

**Cause:** `dev_mode` flag not set in localStorage

**Solution:** Clear localStorage and login again via Dev Login button

## 🔐 Security Best Practices

1. **Never enable in production**
   ```env
   # ❌ BAD - dangerous!
   NODE_ENV=production
   DEV_BYPASS_AUTH=true
   ```

2. **Use in CI/CD?** - No! Use real Telegram test account or mock auth in tests

3. **Share .env file?** - No! Each developer should have their own `.env`

4. **Commit DEV_BYPASS_AUTH?** - Only in `.env.example` (commented out)

## 📝 Logs

Dev mode usage is logged with WARNING level:

```
[server] ⚠️  DEV LOGIN BYPASS USED - User: devuser (123456789)
```

This helps identify when dev mode is accidentally used.

## 🎯 Use Cases

### ✅ Good Uses

- Local development and testing
- Rapid iteration on features
- Testing different user roles quickly
- Debugging authentication issues

### ❌ Bad Uses

- Production deployments
- Public demos (use real Telegram auth)
- CI/CD pipelines (use proper test setup)
- Sharing instances with others

## 🔄 Comparison with Real Auth

| Feature | Real Auth | Dev Bypass |
|---------|-----------|------------|
| Setup | Telegram bot + widget | Just .env var |
| Speed | ~5 seconds | Instant |
| Security | High | Dev only |
| User data | Real Telegram | Configurable |
| Testing | Production-like | Fast iteration |

## 💡 Tips

1. **Keep both ready:** Configure real Telegram auth too, switch as needed

2. **Use real ID:** Set `DEV_USER_TELEGRAM_ID` to your actual Telegram ID for testing bot admin features

3. **Multiple users:** Use different browser profiles with different localStorage to test multi-user scenarios

4. **Clear state:** Clear localStorage between dev login tests to simulate first-time users

## FAQ

**Q: Is dev mode safe?**
A: Yes, it's automatically disabled in production and from non-localhost IPs.

**Q: Can I use dev mode over network?**
A: No, it only works from localhost (127.0.0.1).

**Q: Does dev mode affect bot admin IDs?**
A: Yes! If you create bots while using dev login, your dev user ID becomes the bot owner.

**Q: Can I have multiple dev users?**
A: No, only one dev user per instance. Use browser profiles for multiple users.

**Q: Should I disable it before deploying?**
A: Not necessary - it auto-disables in production. But you can remove it from `.env` for clarity.

**Q: Can I use this with Docker?**
A: Yes, but only if accessing via http://localhost:3000 (not container IP).
