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
let intervals = [], timeouts = [];
let roomIteration =[];

const port = process.env.PORT || 4004;
const index = require("./routes/index");

const app = express();
app.use(index);

const server = http.createServer(app);
const io = socketIo(server);
let particleDetails = [];
let requestForSwarming;
let swarmStart = false;
let gamePlayerActivities = [];
let error = false;

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
      //console.log('checking rooms');
      rooms = io.sockets.adapter.rooms;
      //console.log(rooms);
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
      //console.log(`Done room checking`);
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
      const interVal = intervals.findIndex(interval=>interval.room === request.roomId);
      const timeVal = timeouts.findIndex(timeout=>timeout.room === request.roomId);
      if (interVal !== -1) {
         clearInterval(intervals[interVal].interval);
         intervals.splice(interVal, 1);
      }
      if (timeVal !== -1) {
         clearTimeout(timeouts[timeVal].timeout);
         timeouts.splice(timeVal, 1);
      }
      const indice = roomIteration.findIndex(r=>r.room === request.roomId);
      if(indice !== -1) {
         roomIteration.splice(indice, 1);
      }
      console.log('1st api', JSON.stringify(request));
      api.post(`${baseUrl}/loadSwarmDataNew`, request)
         .then((response) => {
            console.log(`success response loadSwarmDataNew : ${response.data} \n SwarmDuration : ${swarmDuration}`);
            io.to(request.roomId).emit('start-swarming', swarmDuration);
            roomIteration.push({
               room : request.roomId,
               iteration : 0
            });
            error = false;
            //console.log(roomIteration.);
            startSwarming(request.roomId);
            swarmStart = true;
         })
         .catch((error) => console.log('error loadSwarmDataNew', error));
   });

   const startSwarming = (room) => {
      //console.log(roomIteration)
      const interval = setInterval((roomId) => {
         let room = roomIteration.find(r=>r.room === roomId);
         //console.log(`Request : ${JSON.stringify(room)}`)
         if(room === undefined) {
            console.log("mil gya");
         }
         room.iteration = room.iteration + 1;
         if(room.iteration > maxIteration) {
            console.log('catch me if you can');
         }
         if(room.requestForSwarming !== undefined) {
            room.requestForSwarming.iteration = room.iteration;
            room.requestForSwarming.maxIteration = maxIteration;
            gamePlayerActivities = [];
            console.log('requestForSwarming', JSON.stringify(room.requestForSwarming));
            api.post(`${baseUrl}/calculateGlobalBestSolutionNew`, room.requestForSwarming)
            .then((response) => {
               response.data.roomId = roomId;
               //console.log(`ResponseForSwarmming : ${JSON.stringify(response.data)}`);
               io.in(roomId).emit('updated-options', response.data);
            })
            .catch((error) => {
               clearInterval(interval);
               clearTimeout(timeout);
               console.log(`${room} error calculateGlobalBestSolutionNew`, error)});
         }
      }, apiCall, room);
      intervals.push({
         room,
         interval
      });
      const timeout = setTimeout((roomId) => {
         clearInterval(interval);
         let room = roomIteration.find(r=>r.room === roomId);
         room.requestForSwarming.iteration = room.iteration + 1;
         room.requestForSwarming.maxIteration = maxIteration;
         console.log('Last call to requestForSwarming', JSON.stringify(room.requestForSwarming));
         api.post(`${baseUrl}/calculateGlobalBestSolutionNew`, room.requestForSwarming)
         .then((response) => {
            response.data.roomId = roomId;
            console.log(`ResponseForSwarmming : ${JSON.stringify(response.data)}`);
            io.in(roomId).emit('updated-options', response.data);
            io.in(roomId).emit('swarm-completed');
            //clear
            if(room.iteration > maxIteration) {
               console.log('catch me if you can timeout');
            }
            //const indice = roomIteration.findIndex(r => r.room === roomId);
         })
         .catch((error) => {
            error = true;
            console.log(`${room} error calculateGlobalBestSolutionNew`, error)})
         ;
      }, swarmDuration, room);
      timeouts.push({room, timeout})
   }

   socket.on('option-selected', (request) => {
       if (!error) {
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
            console.log(roomIteration);
            const indice = roomIteration.findIndex(r => r.room === request.roomId);
            if(indice !== -1) {
               roomIteration[indice].requestForSwarming = {roomId: request.roomId, particles: gamePlayerActivities.filter(player => player.roomId === request.roomId).map(player => ({particleId: player.particleId, positions: player.positions}))};
               console.log(roomIteration[indice].requestForSwarming);
            } else {
               console.log(`${JSON.stringify(roomIteration)} and ${request.roomId}`);
            }
        }
   });

});

server.listen(port, () => console.log(`Listening on port ${port}`));