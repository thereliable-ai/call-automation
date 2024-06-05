FROM node:latest  
WORKDIR /app  

COPY package*.json ./  
RUN npm install  
COPY . .  

EXPOSE 3000  
COPY run.sh /app/run.sh
RUN chmod +x /app/run.sh

CMD [ "/app/run.sh" ] 
