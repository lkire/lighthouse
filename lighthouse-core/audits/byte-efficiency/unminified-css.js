/**
 * @license Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const ByteEfficiencyAudit = require('./byte-efficiency-audit');
const UnusedCSSRules = require('./unused-css-rules');

const IGNORE_THRESHOLD_IN_PERCENT = 5;
const IGNORE_THRESHOLD_IN_BYTES = 2048;

/**
 * @fileOverview
 */
class UnminifiedCSS extends ByteEfficiencyAudit {
  /**
   * @return {LH.Audit.Meta}
   */
  static get meta() {
    return {
      id: 'unminified-css',
      title: 'Minify CSS',
      scoreDisplayMode: ByteEfficiencyAudit.SCORING_MODES.NUMERIC,
      description: 'Minifying CSS files can reduce network payload sizes. ' +
        '[Learn more](https://developers.google.com/web/tools/lighthouse/audits/minify-css).',
      requiredArtifacts: ['CSSUsage', 'devtoolsLogs'],
    };
  }

  /**
   * Computes the total length of the meaningful tokens (CSS excluding comments and whitespace).
   *
   * @param {string} content
   * @return {number}
   */
  static computeTokenLength(content) {
    let totalTokenLength = 0;
    let isInComment = false;
    let isInLicenseComment = false;
    let isInString = false;
    let stringOpenChar = null;

    for (let i = 0; i < content.length; i++) {
      const twoChars = content.substr(i, 2);
      const char = twoChars.charAt(0);

      const isWhitespace = char === ' ' || char === '\n' || char === '\t';
      const isAStringOpenChar = char === `'` || char === '"';

      if (isInComment) {
        if (isInLicenseComment) totalTokenLength++;

        if (twoChars === '*/') {
          if (isInLicenseComment) totalTokenLength++;
          isInComment = false;
          i++;
        }
      } else if (isInString) {
        totalTokenLength++;
        if (char === '\\') {
          totalTokenLength++;
          i++;
        } else if (char === stringOpenChar) {
          isInString = false;
        }
      } else {
        if (twoChars === '/*') {
          isInComment = true;
          isInLicenseComment = content.charAt(i + 2) === '!';
          if (isInLicenseComment) totalTokenLength += 2;
          i++;
        } else if (isAStringOpenChar) {
          isInString = true;
          stringOpenChar = char;
          totalTokenLength++;
        } else if (!isWhitespace) {
          totalTokenLength++;
        }
      }
    }

    // If the content contained unbalanced comments, it's either invalid or we had a parsing error.
    // Report the token length as the entire string so it will be ignored.
    if (isInComment || isInString) {
      return content.length;
    }

    return totalTokenLength;
  }

  /**
   * @param {LH.Artifacts.CSSStyleSheetInfo} stylesheet
   * @param {LH.Artifacts.NetworkRequest=} networkRecord
   * @param {string} pageUrl
   * @return {{url: string, totalBytes: number, wastedBytes: number, wastedPercent: number}}
   */
  static computeWaste(stylesheet, networkRecord, pageUrl) {
    const content = stylesheet.content;
    const totalTokenLength = UnminifiedCSS.computeTokenLength(content);

    let url = stylesheet.header.sourceURL;
    if (!url || url === pageUrl) {
      const contentPreview = UnusedCSSRules.determineContentPreview(stylesheet.content);
      url = contentPreview;
    }

    const totalBytes = ByteEfficiencyAudit.estimateTransferSize(networkRecord, content.length,
      'Stylesheet');
    const wastedRatio = 1 - totalTokenLength / content.length;
    const wastedBytes = Math.round(totalBytes * wastedRatio);

    return {
      url,
      totalBytes,
      wastedBytes,
      wastedPercent: 100 * wastedRatio,
    };
  }

  /**
   * @param {LH.Artifacts} artifacts
   * @param {Array<LH.Artifacts.NetworkRequest>} networkRecords
   * @return {ByteEfficiencyAudit.ByteEfficiencyProduct}
   */
  static audit_(artifacts, networkRecords) {
    const pageUrl = artifacts.URL.finalUrl;
    const items = [];
    for (const stylesheet of artifacts.CSSUsage.stylesheets) {
      const networkRecord = networkRecords
        .find(record => record.url === stylesheet.header.sourceURL);
      if (!stylesheet.content) continue;

      const result = UnminifiedCSS.computeWaste(stylesheet, networkRecord, pageUrl);

      // If the ratio is minimal, the file is likely already minified, so ignore it.
      // If the total number of bytes to be saved is quite small, it's also safe to ignore.
      if (result.wastedPercent < IGNORE_THRESHOLD_IN_PERCENT ||
          result.wastedBytes < IGNORE_THRESHOLD_IN_BYTES ||
          !Number.isFinite(result.wastedBytes)) continue;
      items.push(result);
    }

    return {
      items,
      headings: [
        {key: 'url', valueType: 'url', label: 'URL'},
        {key: 'totalBytes', valueType: 'bytes', label: 'Original'},
        {key: 'wastedBytes', valueType: 'bytes', label: 'Potential Savings'},
      ],
    };
  }
}

module.exports = UnminifiedCSS;
