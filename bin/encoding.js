'use strict';
/* Copyright 2024 by John Kristian

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

const UTF8 = 'UTF-8';
const LATIN_1 = 'Latin-1'; // I mean ISO/IEC 8859-1:1998 <https://en.wikipedia.org/wiki/ISO/IEC_8859-1>
const WINDOWS_1252 = 'Windows-1252';
const encodingAliases = {
    'cp1252': WINDOWS_1252,
    'cp-1252': WINDOWS_1252,
    'win1252': WINDOWS_1252,
    'win-1252': WINDOWS_1252,
    'windows-1252': WINDOWS_1252,
    // https://www.rfc-editor.org/rfc/rfc1345.html
    'cp819': LATIN_1,
    'cp-819': LATIN_1,
    'latin1': LATIN_1,
    'latin-1': LATIN_1,
    'iso8859-1': LATIN_1,
    'iso 8859-1': LATIN_1,
    'iso-8859-1': LATIN_1,
    'iso_8859-1': LATIN_1,
    'utf8': UTF8,
    'utf-8': UTF8,
}

function normalize(e) {
    return e && (encodingAliases[e.toLowerCase()] || e);
}

function uniqueCharacters(s) {
    var result = null;
    if (s) {
        result = '';
        const set = {};
        for (var c of s) {
            if (!set[c]) {
                set[c] = true;
                result += c;
            }
        }
    }
    return result;
}

const findBadBytes = {};
findBadBytes[UTF8] = function findBadUTF8(b) {
    try {
        decodeURIComponent(escape(b));
        return null;
    } catch(err) {
        return uniqueCharacters(b);
    }
};
findBadBytes[LATIN_1] = function findBadLatin1(b) {
    var bad = '';
    for (var c of b) {
        var code = c.charCodeAt(0);
        if (code > 0xFF || (code > 0x7F && code < 0xA0)) {
            bad += c;
        }
    }
    return uniqueCharacters(bad);
};
const badWindows1252 = '\u0081\u008D\u008F\u0090\u009D';
findBadBytes[WINDOWS_1252] = function findBadWindows1252(b) {
    var bad = '';
    for (var c of b) {
        if (badWindows1252.indexOf(c) >= 0 || c.charCodeAt(0) > 0xFF) {
            bad += c;
        }
    }
    return uniqueCharacters(bad);
};

// Windows-1252 is the same as ISO 8859-1, except for:
const encodeWindowsMap = {
    '\u20AC': '\u0080', // EURO SIGN
    '\u201A': '\u0082', // SINGLE LOW-9 QUOTATION MARK
    '\u0192': '\u0083', // LATIN SMALL LETTER F WITH HOOK
    '\u201E': '\u0084', // DOUBLE LOW-9 QUOTATION MARK
    '\u2026': '\u0085', // HORIZONTAL ELLIPSIS
    '\u2020': '\u0086', // DAGGER
    '\u2021': '\u0087', // DOUBLE DAGGER
    '\u02C6': '\u0088', // MODIFIER LETTER CIRCUMFLEX ACCENT
    '\u2030': '\u0089', // PER MILLE SIGN
    '\u0160': '\u008A', // LATIN CAPITAL LETTER S WITH CARON
    '\u2039': '\u008B', // SINGLE LEFT-POINTING ANGLE QUOTATION MARK
    '\u0152': '\u008C', // LATIN CAPITAL LIGATURE OE
    '\u017D': '\u008E', // LATIN CAPITAL LETTER Z WITH CARON
    '\u2018': '\u0091', // LEFT SINGLE QUOTATION MARK
    '\u2019': '\u0092', // RIGHT SINGLE QUOTATION MARK
    '\u201C': '\u0093', // LEFT DOUBLE QUOTATION MARK
    '\u201D': '\u0094', // RIGHT DOUBLE QUOTATION MARK
    '\u2022': '\u0095', // BULLET
    '\u2013': '\u0096', // EN DASH
    '\u2014': '\u0097', // EM DASH
    '\u02DC': '\u0098', // SMALL TILDE
    '\u2122': '\u0099', // TRADE MARK SIGN
    '\u0161': '\u009A', // LATIN SMALL LETTER S WITH CARON
    '\u203A': '\u009B', // SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
    '\u0153': '\u009C', // LATIN SMALL LIGATURE OE
    '\u017E': '\u009E', // LATIN SMALL LETTER Z WITH CARON
    '\u0178': '\u009F', // LATIN CAPITAL LETTER Y WITH DIAERESIS
};
const encodeWindowsRegex = new RegExp('[' + Object.keys(encodeWindowsMap).join('') + ']', 'g');
const decodeWindowsMap = function invert(m) {
    var result = {};
    for (var key in m) {
        result[m[key]] = key;
    }
    return result;
}(encodeWindowsMap);
const decodeWindowsRegex = new RegExp('[\u0080-\u009F]', 'g');

/** Encode a string to bytes. */
const encode = {};
encode[UTF8] = function encodeUTF8(s) {
    return s && Buffer.from(s, 'utf-8').toString('binary');
};
encode[WINDOWS_1252] = function encodeWindows1252(s) {
    return s && s.replace(encodeWindowsRegex, function(c) {
        return encodeWindowsMap[c] || c;
    });
};
encode[LATIN_1] = encode[WINDOWS_1252];
// It's useful to encode Latin-1 like Windows-1252.
// All the valid Latin-1 characters will be encoded correctly,
// and stray Windows characters will also be encoded reasonably.
// This is necessary to implement the Upload button in manual.html,
// which always decodes the file using 'windows-1252'.

/** Decode a string from bytes. */
const decode = {};
decode[UTF8] = function decodeUTF8(bytes) {
    return bytes && Buffer.from(bytes, 'binary').toString('utf-8');
};
decode[LATIN_1] = function(bytes) {return bytes;};
decode[WINDOWS_1252] = function decodeWindows1252(bytes) {
    return bytes && bytes.replace(decodeWindowsRegex, function(b) {
        return decodeWindowsMap[b] || b;
    });
}

/** Encode to UTF-8 and then decode from the selected encoding. */
const transEncode = {};
transEncode[UTF8] = function(s) {return s;};
transEncode[LATIN_1] = function transEncodeLatin1(s) {
    return decode[LATIN_1](encode[UTF8](s));
};
transEncode[WINDOWS_1252] = function transEncodeWindows1252(s) {
    return decode[WINDOWS_1252](encode[UTF8](s));
};

/** Encode to the selected encoding and then decode from UTF8. */
const transDecode = {};
transDecode[UTF8] = function(s) {return s;};
transDecode[LATIN_1] = function transDecodeLatin1(s) {
    return decode[UTF8](encode[LATIN_1](s));
};
transDecode[WINDOWS_1252] = function transDecodeWindows1252(s) {
    return decode[UTF8](encode[WINDOWS_1252](s));
};

// node.js spells 'utf-8' all lower case.
findBadBytes['utf-8'] = findBadBytes[UTF8];
encode['utf-8'] = encode[UTF8];
decode['utf-8'] = decode[UTF8];
transEncode['utf-8'] = transEncode[UTF8];
transDecode['utf-8'] = transDecode[UTF8];

exports.UTF8 = UTF8;
exports.LATIN_1 = LATIN_1;
exports.WINDOWS_1252 = WINDOWS_1252;
exports.decode = decode;
exports.encode = encode;
exports.findBadBytes = findBadBytes;
exports.normalize = normalize;
exports.transDecode = transDecode;
exports.transEncode = transEncode;
