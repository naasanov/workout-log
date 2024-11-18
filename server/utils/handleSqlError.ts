import { Response } from "express";
import SqlError from "./sqlErrors";

/**
 * Contains a collection of statuses and messages for certain SQL error codes, 
 * and a fallback if a different error was presented. Used for SQL error handling.  
 * [key in SqlError]?: [number, string];  
 * fallback?: [number, string];
 */
type ErrorMap = {
    [key in SqlError]?: [number, string];
} & {
    fallback?: [number, string]
}

/**
 * Util function used to determine if a given error is an sql error
 * @param error Error to be checked
 * @returns The error as type any if it is an sql error, undefined if is not
 */
function getSqlError(error: unknown) {
    return (
        error instanceof Error && 'code' in error
        ? error as any 
        : undefined
    )
}

/**
 * Sends a status and message response back to the client based on the provided error map  
 * Sends status of 500 with "Internal Server Error" as message if fallback property in error map is not provided
 * @param error 
 * @param res Response object of current request handler
 * @param errorMap Defines behavior for specified errors
 */
function handleSqlError(error: unknown, res: Response, errorMap: ErrorMap) {
    console.log(error);
    const sqlError = getSqlError(error);
    const fallback = errorMap.fallback || [500, "Internal Server Error"];
    
    const mapping = errorMap[sqlError?.code as SqlError];
    const [status, message] = mapping || fallback;

    res.status(status).json({ message })
}

export default handleSqlError;