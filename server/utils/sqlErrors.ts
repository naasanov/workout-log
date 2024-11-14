interface SQLErrors {
    NULL_ERROR: string,
    PARSE_ERROR: string,
    DUPLICATE_ERROR: string,
    FIELD_ERROR: string
}

const sqlErrors: SQLErrors = {
    NULL_ERROR: "ER_BAD_NULL_ERROR",
    PARSE_ERROR: "ER_PARSE_ERROR",
    DUPLICATE_ERROR: "ER_DUP_ENTRY",
    FIELD_ERROR: "ER_BAD_FIELD_ERROR"
}

export default sqlErrors;