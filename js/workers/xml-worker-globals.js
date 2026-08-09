/**
 * Worker XML globals — must be the FIRST import of any worker that pulls in
 * @mapbox/togeojson.
 *
 * Dedicated workers have no XMLSerializer/DOMParser globals, and togeojson
 * creates an XMLSerializer at module-evaluation time (throwing "Unable to
 * initialize serializer" otherwise). Installing the @xmldom/xmldom
 * implementations first keeps the whole toolchain consistent: documents are
 * parsed and serialized by the same DOM implementation.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

if (typeof globalThis.XMLSerializer === 'undefined') {
    globalThis.XMLSerializer = XMLSerializer;
}
if (typeof globalThis.DOMParser === 'undefined') {
    globalThis.DOMParser = DOMParser;
}
