# littb-snapshot

Ajaxsnapshot generator for Googlebot. 

# Usage: 
1. `yarn install` or `npm install`
2. `yarn start` or `npm run start`
3. Build with s2i: `s2i build https://github.com/spraakbanken/littb-snapshot.git jroxendal/puppeteer-openshift-builder:latest jroxendal/littb-snapshot`
4. Publish to Openshift: `oc new-app jroxendal/puppeteer-openshift-builder:latest~https://github.com/spraakbanken/littb-snapshot.git`, where puppeteer-openshift-builder is built from `./builder/Dockerfile`. 

TODO:
1. Error management: if a page in the reader comes up without any content, an error code should be reported. 

