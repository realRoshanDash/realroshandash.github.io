FROM nginx:1.21.0-alpine 
#configuration
COPY ./nginx.conf /etc/nginx/nginx.conf
#content, comment out the ones you dont need!
COPY . /usr/share/nginx/html