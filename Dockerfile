# Use Debian Slim (instead of Alpine) to ensure build tools like 'ps' work correctly
FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

COPY . .

# FIX: Rename config to .mjs to prevent ESM errors (just in case)
RUN if [ -f vite.config.js ]; then mv vite.config.js vite.config.mjs; fi

# BUILD STEP
# This compiles the web assets to the '/app/dist' folder.
RUN npm run build:web

# SERVE STEP
# Install a simple static file server to serve the 'dist' folder
RUN npm install -g serve

# Environment
ENV TZ=Europe/Madrid

# Expose Vite's default build port (we can use 3000 or 5173, let's stick to 5173)
EXPOSE 5173

# Start the static file server
CMD ["serve", "-s", "dist", "-l", "5173"]
