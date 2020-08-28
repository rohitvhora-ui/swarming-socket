const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const api = require("axios");
const _ = require('lodash');

//const baseUrl = 'https://swarmoptimization.azurewebsites.net/swarmIntelligencePSO';
const baseUrl = 'https://swarmapi.azurewebsites.net/swarmIntelligencePSO';
//const baseUrl = 'https://springbootswarmapi.azurewebsites.net/swarmIntelligencePSO;
const swarmDuration = 120000;

const port = process.env.PORT || 4003;
const index = require("./routes/index");

const app = express();
app.use(index);

const server = http.createServer(app);
const io = socketIo(server);
let particleDetails = [];
let requestForSwarming;
let swarmStart = false;

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

   socket.on('checkRooms', ()=>{
      let gameActive = {'roomid' : '', 'gameActive': false};
      console.log('checking rooms');
      rooms = io.sockets.adapter.rooms;
      console.log(rooms);
      for (var room in rooms) {
         if(room.length > 0 && room.length<=2) {
            if(rooms[room].length > 1 && swarmStart) {
               gameActive = {'roomId' : room, 'gameActive': true};
            } else if (rooms[room].length > 1) {
               gameActive = {'roomId' : room, 'gameActive': false};
            }else if (rooms[room].length === 1) {
               gameActive = {'roomId' : room, 'gameActive': false};
               swarmStart = false;
            }
            io.emit('checkRooms', gameActive);
         }
      }   
      console.log(`Done room checking`);
   });


   socket.on('add_user', user => {
      socket.user = user;
      console.log(`socket_room: ${socket.room}`);
      setTimeout(() => {
         emitOnlineUsers(socket.room);
      }, 50)
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
            console.log(`success response loadSwarmDataNew : ${response.data} \n SwarmDuration : ${swarmDuration}`);
            io.to(request.roomId).emit('start-swarming', swarmDuration);
            startSwarming(request.roomId);
            swarmStart = true;
         })
         .catch((error) => console.log('error loadSwarmDataNew', error));
   });

   const startSwarming = () => {
      const interval = setInterval(() => {
         console.log('requestForSwarming', requestForSwarming);
         api.post(`${baseUrl}/calculateGlobalBestSolutionNew`, requestForSwarming)
         .then((response) => {
            io.emit('updated-options', response.data);
         })
         .catch((error) => console.log('error calculateGlobalBestSolutionNew', error));
      }, 2000);
      setTimeout(() => {
         clearInterval(interval);
         api.post(`${baseUrl}/calculateGlobalBestSolutionNew`, requestForSwarming)
         .then((response) => {
            io.emit('updated-options', response.data);
            io.emit('swarm-completed');
         })
         .catch((error) => console.log('error calculateGlobalBestSolutionNew', error));
      }, swarmDuration);
   }

   socket.on('option-selected', (request) => {
      particleDetails = [request, ...particleDetails];
      particleDetails = (_.uniqBy(particleDetails, (particle) => particle.particleId));
      requestForSwarming = {roomId: request.roomId, particles: particleDetails.map(p => ({particleId: p.particleId, position: p.position}))};
   });

});

server.listen(port, () => console.log(`Listening on port ${port}`));