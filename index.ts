import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'

// --- Data Structure ---
interface Player {
  id: string
  username: string
}

interface Room {
  id: string
  players: Player[]
  status: 'waiting' | 'playing'
  boardState: any 
}

const rooms = new Map<string, Room>()

// --- Server Setup ---
const app = new Elysia()
  .use(cors()) // อนุญาตให้ Frontend คุยกับ Backend ได้
  .use(swagger()) // เปิดหน้าเว็บทดสอบ API ที่ /swagger
  
  // --- State & Logic ---
  .state('roomCount', 0)

  .get('/rooms', () => {
    return Array.from(rooms.values()).filter(r => r.status === 'waiting')
  })

  .post('/room/create', ({ body }) => {
    const roomId = `room-${Math.random().toString(36).slice(2, 7)}`
    const newRoom: Room = {
      id: roomId,
      players: [{ id: 'host', username: body.username }],
      status: 'waiting',
      boardState: null
    }
    rooms.set(roomId, newRoom)
    return { roomId, message: 'สร้างห้องสำเร็จ' }
  }, {
    body: t.Object({ username: t.String() })
  })

  // WebSocket ระบบเล่นเกม Real-time
  .ws('/game/:roomId', {
    params: t.Object({
      roomId: t.String()
    }),
    body: t.Object({
      type: t.String(), // 'MOVE', 'CHAT', 'RESET'
      payload: t.Any()
    }),
    
    open(ws) {
      const { roomId } = ws.data.params
      const room = rooms.get(roomId)

      if (!room) {
        ws.send({ error: 'ไม่พบห้องนี้' })
        ws.close()
        return
      }

      ws.subscribe(roomId)
      console.log(`👤 Player joined: ${roomId}`)
    },

    message(ws, message) {
      const { roomId } = ws.data.params
      
      ws.publish(roomId, {
        sender: ws.id,
        ...message
      })
    },

    close(ws) {
      const { roomId } = ws.data.params
      ws.unsubscribe(roomId)
      console.log(`Player left: ${roomId}`)
      // if (rooms.get(roomId)?.players.length === 0) rooms.delete(roomId)
    }
  })

  .listen(3000)

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)