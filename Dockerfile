# Use official Puppeteer image which includes Chrome for Testing
FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /home/pptruser/app

# Copy package files first for better caching
COPY --chown=pptruser:pptruser package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy application source
COPY --chown=pptruser:pptruser . .

ENV HOST=0.0.0.0
ENV PORT=8282

EXPOSE 8282

CMD ["npm", "start"]