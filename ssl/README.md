# SSL Certificates for Local Development

This directory contains self-signed SSL certificates for HTTPS development.

## Files

- `cert.pem` - SSL certificate
- `key.pem` - Private key

## Usage

The server automatically uses these certificates when running in development mode (`NODE_ENV=development`).

## Browser Security Warning

When accessing `https://localhost:4000` in your browser, you'll see a security warning because the certificate is self-signed. This is normal for development.

### To bypass the warning:

**Chrome/Edge:**
1. Click "Advanced"
2. Click "Proceed to localhost (unsafe)"

**Firefox:**
1. Click "Advanced"
2. Click "Accept the Risk and Continue"

**Safari:**
1. Click "Show Details"
2. Click "visit this website"
3. Click "Visit Website"

## Regenerating Certificates

If you need to regenerate the certificates:

```bash
openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

## Security Note

These certificates are for development only. Never use them in production.
