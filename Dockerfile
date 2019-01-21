FROM alekzonder/puppeteer:1.1.1

# Create app directory
# WORKDIR /usr/src/app
RUN mkdir /app/node_modules/
COPY package.json yarn.lock ./
RUN yarn install

# Bundle app source
COPY . .

EXPOSE 3000

CMD yarn start