import { Peer, DataConnection } from 'peerjs';
import { Entity } from './Entity';
import { MessageType, type NetworkMessage } from './types';

export class Net {
  peer: Peer | null = null;
  connections: DataConnection[] = [];
  isHost: boolean = false;

  constructor() {
    this.peer = null;
    this.connections = [];
    this.isHost = false;
  }

  host(id: string): void {
    this.peer = new Peer(id);
    this.isHost = true;

    this.peer.on('open', (id) => {
      console.log('Host ID:', id);
    });

    this.peer.on('connection', (conn) => {
      this.connections.push(conn);
      conn.on('open', () => {
        conn.send('Hello!');
      });
      conn.on('data', (data) => {
        this.onData(conn, data as NetworkMessage);
      });
    });
  }

  join(hostid: string): void {
    this.isHost = false;
    this.peer = new Peer();
    this.peer.on('open', (id) => {
      console.log('Client ID:', id);
      const conn = this.peer!.connect(hostid);
      conn.on('open', () => {
        conn.send({ msg: MessageType.PLAYER_JOIN });
      });
      conn.on('data', (data) => {
        this.onData(conn, data as NetworkMessage);
      });
    });
  }

  onData(conn: DataConnection, data: any): void {
    switch (data.msg) {
      case MessageType.PLAYER_JOIN:
        console.log('Player joined');
        if (this.isHost) {
          for (const connection of this.connections) {
            connection.send(data);
          }
        }
        break;
      case MessageType.PLAYER_LEAVE:
        break;
      case MessageType.CHAT:
        break;
      case MessageType.ENTITY_UPDATE:
        if (!this.isHost) {
          for (const e of Entity.all) {
            if (e.id === data.id) {
              e.localPosition[0] = data.pos[0];
              e.localPosition[1] = data.pos[1];
              e.localPosition[2] = data.pos[2];
              e.localRotation[0] = data.ori[0];
              e.localRotation[1] = data.ori[1];
              e.localRotation[2] = data.ori[2];
              e.localRotation[3] = data.ori[3];
            }
          }
        }
        break;
    }
  }

  update(): void {
    if (!this.isHost) {
      return;
    }

    for (const e of Entity.all) {
      if (e.id > 0) {
        for (const conn of this.connections) {
          conn.send({
            msg: MessageType.ENTITY_UPDATE,
            id: e.id,
            pos: [e.localPosition[0], e.localPosition[1], e.localPosition[2]],
            ori: [e.localRotation[0], e.localRotation[1], e.localRotation[2], e.localRotation[3]]
          });
        }
      }
    }
  }
}
