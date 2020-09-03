const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const api = require("axios");
const _ = require('lodash');

//const baseUrl = 'https://swarmoptimization.azurewebsites.net/swarmIntelligencePSO';
const baseUrl = 'https://swarmapi.azurewebsites.net/swarmIntelligencePSO';
//const baseUrl = 'https://springbootswarmapi.azurewebsites.net/swarmIntelligencePSO;
const swarmDuration = 90000;
const apiCall = 3000;
const maxIteration = swarmDuration/apiCall;
let iteration = 0;
let roomIteration =[];

const port = process.env.PORT || 4003;
const index = require("./routes/index");

const app = express();
app.use(index);

const server = http.createServer(app);
const io = socketIo(server);
let particleDetails = [];
let requestForSwarming;
let swarmStart = false;
let gamePlayerActivities = [];

const getOnlineUsers = (room) => {
   console.log(`room : ${room}`);
   let clients = io.sockets.clients().connected;
   let sockets = Object.values(clients);
   let users = sockets.map(u => u.user);
   return users.filter(u => u != undefined && u.room === room);
};

const removeConsecutive = (objects) => {
  return _.reject(objects,  (object, i) => {
      return i > 0 && objects[i - 1].x === object.x && objects[i - 1].y === object.y;
   });
};

const emitOnlineUsers = (socket) => {
   io.in(socket.room).emit("usersOnline", getOnlineUsers(socket.room));
}

const getApiAndEmit = socket => {
   const response = new Date();
   // Emitting a new message. Will be consumed by the client
   socket.emit("KeepMeAlive", response);
 };

io.on('connection', (socket) => {
   console.log(`Connected: ${socket.id}`);
   if (connectionInterval) {
      clearInterval(connectionInterval);
    }
   var connectionInterval = setInterval(() => getApiAndEmit(socket), 10);

   socket.on("KeepMeAlive", data =>{
      //console.info(`Keep me Alive from client:  ${data}`);
   })

   socket.once('disconnect', () => {
      console.log(`Disconnected: ${socket.id}`)
      clearInterval(connectionInterval);
      //const { room } = socket;
      if (socket.room) {
         emitOnlineUsers(socket);
      }
   });

   socket.once('join', (room) => {
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


   socket.once('add_user', user => {
      socket.user = user;
      console.log(`socket_room: ${socket.room}`);
      setTimeout(() => {
         emitOnlineUsers(socket);
      }, 50)
   })

   socket.on('canvas', (data) => {
      const { room, name, coordinate, color, opacity } = data;
      globalRoom = room;
   });

   socket.once('can-start-swarming', (request) => {
      console.log('1st api', JSON.stringify(request));
      api.post(`${baseUrl}/loadSwarmDataNew`, request)
         .then((response) => {
            console.log(`success response loadSwarmDataNew : ${response.data} \n SwarmDuration : ${swarmDuration}`);
            io.to(request.roomId).emit('start-swarming', swarmDuration);
            
            const indice = roomIteration.findIndex(r=>r.room === request.roomId);
            if (indice === -1) {
               roomIteration.push({
                  room : request.roomId,
                  iteration : 0,
                  requestForSwarming : undefined
               });
            } else {
               roomIteration.splice(indice, 1 , {
                  room : request.roomId,
                  iteration : 0,
                  requestForSwarming : undefined
               });
            }
            startSwarming(request.roomId);
            swarmStart = true;
         })
         .catch((error) => console.log('error loadSwarmDataNew', error));
   });

   const startSwarming = (room) => {
      const interval = setInterval((roomId) => {
         const indice = roomIteration.findIndex(r => r.room === roomId);
         roomIteration[indice].iteration = roomIteration[indice].iteration + 1;
            if(roomIteration[indice].requestForSwarming !== undefined) {
               roomIteration[indice].requestForSwarming.iteration = roomIteration[indice].iteration;
               roomIteration[indice].requestForSwarming.maxIteration = maxIteration;
               gamePlayerActivities = [];
               console.log('requestForSwarming', JSON.stringify(roomIteration[indice].requestForSwarming));
               api.post(`${baseUrl}/calculateGlobalBestSolutionNew`, roomIteration[indice].requestForSwarming)
               .then((response) => {
                  console.log(`ResponseForSwarmming : ${JSON.stringify(response.data)}`);
                  io.in(roomId).emit('updated-options', response.data);
               })
               .catch((error) => {
                  clearInterval(interval);
                  console.log(`${room} error calculateGlobalBestSolutionNew`, error)});
            }
      }, apiCall, room);
      setTimeout((roomId) => {
         clearInterval(interval);
         const indice = roomIteration.findIndex(r => r.room === roomId);
         roomIteration[indice].requestForSwarming.iteration = roomIteration[indice].iteration + 1;
         roomIteration[indice].requestForSwarming.maxIteration = maxIteration;
         console.log('requestForSwarming', JSON.stringify(roomIteration[indice].requestForSwarming));
         api.post(`${baseUrl}/calculateGlobalBestSolutionNew`, roomIteration[indice].requestForSwarming)
         .then((response) => {
            console.log(`ResponseForSwarmming : ${JSON.stringify(response.data)}`);
            io.in(roomId).emit('updated-options', response.data);
            io.in(roomId).emit('swarm-completed');
            //const indice = roomIteration.findIndex(r => r.room === roomId);
         })
         .catch((error) => {
            console.log(`${room} error calculateGlobalBestSolutionNew`, error)})
         ;
      }, swarmDuration, room);
   }

   socket.on('option-selected', (request) => {
      //console.log(request);
      particleDetails = [request, ...particleDetails];
      particleDetails = (_.uniqBy(particleDetails, (particle) => particle.particleId));
      //console.log(particleDetails);
      if (gamePlayerActivities.length === 0) {
         gamePlayerActivities = particleDetails.map(p => ({particleId: p.particleId, positions: new Array(p.position), roomId : p.roomId}));
      } else{
         particleDetails.forEach((particle)=> {
            playerIndex = gamePlayerActivities.findIndex(player => player.particleId === particle.particleId);
            if( playerIndex === -1){
               gamePlayerActivities.push({particleId: particle.particleId, positions: new Array(particle.position), roomId : particle.roomId});
            } else {
               gamePlayerActivities[playerIndex].positions.push(particle.position)
            }
         });
      }

      //requestForSwarming = {roomId: request.roomId, particles: particleDetails.map(p => ({particleId: p.particleId, position: p.position}))};
      gamePlayerActivities.forEach(player=>player.positions = removeConsecutive(player.positions));
      const indice = roomIteration.findIndex(r => r.room === request.roomId);
      roomIteration[indice].requestForSwarming = {roomId: request.roomId, particles: gamePlayerActivities.filter(player => player.roomId === request.roomId).map(player => ({particleId: player.particleId, positions: player.positions}))};
      //console.log(gamePlayerActivities);
   });

});

server.listen(port, () => console.log(`Listening on port ${port}`));