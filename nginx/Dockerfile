ARG NGINX_BASE_IMAGE=public.ecr.aws/nginx/nginx:1.27-alpine
FROM ${NGINX_BASE_IMAGE}

COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/default.conf /etc/nginx/templates/default.conf.template

EXPOSE 8080
