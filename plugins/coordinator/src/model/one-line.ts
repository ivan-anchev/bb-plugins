// Text the coordinating thread writes that the plugin shows one item to a line: a doorbell gives
// each update one line, and a line break would start another; a button holds one line.

/** No line break anywhere: U+2028 and U+2029 are line breaks too. */
export const ONE_LINE = /^[^\r\n\u2028\u2029]*$/;
