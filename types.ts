import { Request } from 'express'; 

type User = { uuid: string }
type RequestWithUser = Request & { user: User }

export { User, RequestWithUser }