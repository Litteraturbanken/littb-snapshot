FROM node:10.15-stretch-slim

RUN apt-get update && \
apt-get install -yq gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 \
libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst ttf-freefont \
ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils &&
apt-get clean && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

RUN yarn global add puppeteer@1.10.0 && yarn cache clean

ENV NODE_PATH="/usr/local/share/.config/yarn/global/node_modules:${NODE_PATH}"

RUN adduser --disabled-password --gid 0 --gecos "App user" appuser
RUN chown appuser:root /home/appuser && chmod 0775 /home/appuser 
ENV HOME /home/appuser
USER appuser
WORKDIR /home/appuser

# Set language to UTF8
ENV LANG="C.UTF-8"

# ENTRYPOINT ["dumb-init", "--"]

COPY package.json yarn.lock ./
RUN yarn install

# Bundle app source
COPY . .

EXPOSE 3000

CMD yarn start