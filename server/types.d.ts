import { Pool } from "mysql2";

declare global {
    namespace Express {
      interface Request {
        pool: Pool;
      }
    };
    type MessageResponse = {
      message: string;
    };
  }

  export {};