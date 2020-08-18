const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const api = require("axios");
const _ = require('lodash');

//const baseUrl = 'https://swarmoptimization.azurewebsites.net/swarmIntelligencePSO';
const baseUrl = 'https://springbootswarmapi.azurewebsites.net/swarmIntelligencePSO';
//const baseUrl = 'https://springbootswarmapi.azurewebsites.net/swarmIntelligencePSO;

const port = process.env.PORT || 4003;
const index = require("./routes/index");

const app = express();
app.use(index);

const server = http.createServer(app);
const io = socketIo(server);
let globalRoom;
let particleDetails = [];
let requestForSwarming;

const getOnlineUsers = (room) => {
   console.log(`room : ${room}`);
   let clients = io.sockets.clients().connected;
   let sockets = Object.values(clients);
   let users = sockets.map(u => u.user);
   return users.filter(u => u != undefined);
};

const emitOnlineUsers = (room) => {
   io.in(room).emit("usersOnline", getOnlineUsers(room));
}

io.on('connection', (socket) => {
   console.log(`Connected: ${socket.id}`);

   socket.on('disconnect', () => {
      console.log(`Disconnected: ${socket.id}`)
      const { room } = socket;
      if (room) {
         emitOnlineUsers(socket.room);
      }
   });

   socket.on('join', (room) => {
      console.log(`Socket ${socket.id} joining ${room}`);
      socket.room = room;
      socket.join(room);
   });

   socket.on('add_user', user => {
      socket.user = user;
      console.log(`socket_room: ${socket.room}`);
      emitOnlineUsers(socket.room);
   })

   socket.on('canvas', (data) => {
      const { room, name, coordinate, color, opacity } = data;
      globalRoom = room;
      //console.log(`coordinate (x:y): ( ${coordinate.x} : ${coordinate.y} ), room: ${room}, name: ${name}`);
      //io.to(room).emit('canvas', { room, name, coordinate, color, opacity });
   });

   socket.on('can-start-swarming', (request) => {
      console.log('1st api', request);
      api.post(`${baseUrl}/loadSwarmDataNew`, request)
         .then((response) => {
            console.log('success response loadSwarmDataNew');
            console.log(response.data);
            io.emit('start-swarming', response.data);
            startSwarming();
         })
         .catch((err) => {
            console.log('error response loadSwarmDataNew', err);
         });
   });

   const startSwarming = () => {
      const interval = setInterval(() => {
         console.log('requestForSwarming', requestForSwarming);
         api.post(`${baseUrl}/calculateGlobalBestSolutionNew`, requestForSwarming)
         .then((response) => {
            console.log('success response calculateGlobalBestSolutionNew');
            io.emit('updated-options', response.data);
         })
         .catch((error) => console.log('error response calculateGlobalBestSolutionNew', error));
      }, 10000);
      setTimeout(() => {
         clearInterval(interval);
         // show popup
      }, 1800000)
   }

   socket.on('option-selected', (request) => {
      particleDetails = [request, ...particleDetails];
      particleDetails = (_.uniqBy(particleDetails, (particle) => particle.particleId));
      requestForSwarming = {roomId: request.roomId, particles: particleDetails.map(p => ({particleId: p.particleId, position: p.position}))};
   });

   setTimeout(() => {
      let coordinate = {
         x: 160,
         y: 200,
      };
      io.in(globalRoom).emit('globalPeg', { coordinate });
   }, 50000)
});

server.listen(port, () => console.log(`Listening on port ${port}`));