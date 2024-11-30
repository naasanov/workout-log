import { Response } from "express";

/**
 * Validates a conventional mySql integer id. If provided a `Response` object, 
 * sends the status and message in the `output` object if provided. Otherwise,
 * sends status of 400 and message of "Request parameter id must be a positive integer".
 * If a `Response` object is not provided, simply returns a boolean.
 * @param id 
 * @param res The `Response` object of the current request
 * @param output An array of length two, with the first element being the status code, 
 * and the second element being the message
 * @returns A boolean stating if the id is valid or not
 */
function validateId(id: string, res?: Response, output?: [number, string]): boolean {
    const parsed = Number(id);
    const validInt = (
        /^\d+$/.test(id)
        && Number.isSafeInteger(parsed)
        && parsed >= 1
    )
    if (!validInt) {
        if (res) {
            const fallback: [number, string] = [400, "Request parameter id must be a positive integer"];
            const [status, message] = output ?? fallback;
            res.status(status).json({ message });
        }
        return false;
    }
    return true;
}

/**
 * Validates the provided label for sections, movements, and variations. Checks if 
 * the label is null/undefined, if it is a string, and if it is shorter than 50 characters.
 * If a response object is provided, sends a json message object describing the issue with
 * a status of 400. Otherwise, just returns the boolean.
 * @param label 
 * @param res `Response` object of the current request
 * @returns A boolean that states whether the provided label is valid
 */
function validateLabel(label: any, res?: Response): boolean {
    if (label === null || label === undefined) {
        res?.status(400).json({ message: "Request body must include a non-null label"});
        return false;
    }
    else if (!(typeof label === 'string' || label instanceof String)) {
        res?.status(400).json({ message: "Label must be a string" });
        return false;
    }
    else if (label.length > 50) {
        res?.status(400).json({ message: "Label must not exceed 50 characters" });
        return false;
    }
    else {
        return true;
    }
}

export { validateId, validateLabel };