export interface BackupReport {
    udid: string;
    encrypted: boolean;
    date: string;
    deviceName: string;
    serialNumber: string;
    iOSVersion: string;
    backupVersion: string;
  }
  
  export interface Call {
    id: number;
    date: string;
    answered: boolean;
    originated: boolean;
    callType: string;
    duration: string;
    location: string;
    country: string;
    service: string;
    address: string;
  }
  
  export interface SMSMessage {
    id: number;
    date: string;
    sender: string;
    text: string;
    dateRead: string;
    dateDelivered: string;
    isDelivered: boolean;
    isFinished: boolean;
    isFromMe: boolean;
    isRead: boolean;
    isSent: boolean;
    attachments: any[];
  }
  
  export interface SMSChat {
    id: number;
    date: string;
    service: string;
    chatName: string;
    displayName: string;
    messages: SMSMessage[];
  }
  
  export interface Contact {
    id: number;
    first: string;
    last: string;
    organization: string | null;
    phoneWork: string | null;
    phoneMobile: string | null;
    phoneHome: string | null;
    iphone: string | null;
    email: string | null;
    createdDate: string;
    note: string | null;
    picture: boolean;
    picture_file: string | null;
    services: {
      google_profile: string | null;
      icloud: string | null;
      service: string | null;
      username: string | null;
      url: string | null;
    };
    address: string | null;
    city: string | null;
  }

  export interface WhatsAppGroupParticipant {
    chatID: number;
    participantID: string;
    interlocutor: string;
    interlocutorAlias: string | null;
    isSender: boolean;
  }

  export interface WhatsAppMessage {
    id: number;
    type: 'GROUP' | 'DIRECT';
    chatID: number;
    content: string;
    sender: string | null;
    receiver: string | null;
    timestamp: number;
    interlocutor: string;
    interlocutorAlias: string | null;
    participants: WhatsAppGroupParticipant[];
  }
  
  declare function run(command: "backups.list"): Promise<BackupReport[]>;
  declare function run(command: "messages.all", options: { backup: string }): Promise<SMSChat[]>;
  declare function run(command: "phone.calls", options: { backup: string }): Promise<Call[]>;
  declare function run(command: "phone.address_book", options: { backup: string }): Promise<Contact[]>;
  declare function run(command: "messages.whatsapp", options: { backup: string }): Promise<WhatsAppMessage[]>;

  
  declare function configure(options: { base: string; id: string; password: string; }): Promise<void>;

  declare function releaseConnections(options: { base: string; id: string; password: string; }): Promise<void>;
  
  export interface Ibackuptool {
    configure: typeof configure;
    run: typeof run;
    releaseConnections: typeof releaseConnections;
  }
  
  declare const ibackuptool: Ibackuptool;
  export = ibackuptool;
  