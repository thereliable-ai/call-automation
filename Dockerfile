FROM node:latest  
WORKDIR /app  

COPY package*.json ./  
RUN npm install  
COPY . .  

EXPOSE 3000  
COPY script /app/script
RUN chmod +x /app/script

CMD [ "/app/script" ] 
