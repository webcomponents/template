/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

// minimal template polyfill
(function() {
  'use strict';

  var needsTemplate = (typeof HTMLTemplateElement === 'undefined');
  var brokenDocFragment = !(document.createDocumentFragment().cloneNode() instanceof DocumentFragment);
  var needsDocFrag = false;

  // NOTE: Replace DocumentFragment to work around IE11 bug that
  // casues children of a document fragment modified while
  // there is a mutation observer to not have a parentNode, or
  // have a broken parentNode (!?!)
  if (/Trident/.test(navigator.userAgent)) {
    (function() {

      needsDocFrag = true;

      var origCloneNode = Node.prototype.cloneNode;
      Node.prototype.cloneNode = function cloneNode(deep) {
        var newDom = origCloneNode.call(this, deep);
        if (this instanceof DocumentFragment) {
          newDom.__proto__ = DocumentFragment.prototype;
        }
        return newDom;
      };

      // IE's DocumentFragment querySelector code doesn't work when
      // called on an element instance
      DocumentFragment.prototype.querySelectorAll = HTMLElement.prototype.querySelectorAll;
      DocumentFragment.prototype.querySelector = HTMLElement.prototype.querySelector;

      Object.defineProperties(DocumentFragment.prototype, {
        'nodeType': {
          get: function () {
            return Node.DOCUMENT_FRAGMENT_NODE;
          },
          configurable: true
        },

        'localName': {
          get: function () {
            return undefined;
          },
          configurable: true
        },

        'nodeName': {
          get: function () {
            return '#document-fragment';
          },
          configurable: true
        }
      });

      var origInsertBefore = Node.prototype.insertBefore;
      function insertBefore(newNode, refNode) {
        if (newNode instanceof DocumentFragment) {
          var child;
          while ((child = newNode.firstChild)) {
            origInsertBefore.call(this, child, refNode);
          }
        } else {
          origInsertBefore.call(this, newNode, refNode);
        }
        return newNode;
      }
      Node.prototype.insertBefore = insertBefore;

      var origAppendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = function appendChild(child) {
        if (child instanceof DocumentFragment) {
          insertBefore.call(this, child, null);
        } else {
          origAppendChild.call(this, child);
        }
        return child;
      };

      var origRemoveChild = Node.prototype.removeChild;
      var origReplaceChild = Node.prototype.replaceChild;
      Node.prototype.replaceChild = function replaceChild(newChild, oldChild) {
        if (newChild instanceof DocumentFragment) {
          insertBefore.call(this, newChild, oldChild);
          origRemoveChild.call(this, oldChild);
        } else {
          origReplaceChild.call(this, newChild, oldChild);
        }
        return oldChild;
      };

      Document.prototype.createDocumentFragment = function createDocumentFragment() {
        var frag = this.createElement('df');
        frag.__proto__ = DocumentFragment.prototype;
        return frag;
      };

      var origImportNode = Document.prototype.importNode;
      Document.prototype.importNode = function importNode(impNode, deep) {
        deep = deep || false;
        var newNode = origImportNode.call(this, impNode, deep);
        if (impNode instanceof DocumentFragment) {
          newNode.__proto__ = DocumentFragment.prototype;
        }
        return newNode;
      };
    })();
  }

  // NOTE: we rely on this cloneNode not causing element upgrade.
  // This means this polyfill must load before the CE polyfill and
  // this would need to be re-worked if a browser supports native CE
  // but not <template>.
  var capturedCloneNode = Node.prototype.cloneNode;
  var capturedCreateElement = Document.prototype.createElement;
  var capturedImportNode = Document.prototype.importNode;
  var capturedRemoveChild = Node.prototype.removeChild;
  var capturedAppendChild = Node.prototype.appendChild;
  var capturedReplaceChild = Node.prototype.replaceChild;

  var elementQuerySelectorAll = Element.prototype.querySelectorAll;
  var docQuerySelectorAll = Document.prototype.querySelectorAll;
  var fragQuerySelectorAll = DocumentFragment.prototype.querySelectorAll;

  var scriptSelector = 'script:not([type]),script[type="application/javascript"],script[type="text/javascript"]';

  function QSA(node, selector) {
    // IE 11 throws a SyntaxError with `scriptSelector` if the node has no children due to the `:not([type])` syntax
    if (!node.childNodes.length) {
      return [];
    }
    switch (node.nodeType) {
      case Node.DOCUMENT_NODE:
        return docQuerySelectorAll.call(node, selector);
      case Node.DOCUMENT_FRAGMENT_NODE:
        return fragQuerySelectorAll.call(node, selector);
      default:
        return elementQuerySelectorAll.call(node, selector);
    }
  }

  // returns true if nested templates cannot be cloned (they cannot be on
  // some impl's like Safari 8 and Edge)
  // OR if cloning a document fragment does not result in a document fragment
  var needsCloning = (function() {
    if (!needsTemplate) {
      var t = document.createElement('template');
      var t2 = document.createElement('template');
      t2.content.appendChild(document.createElement('div'));
      t.content.appendChild(t2);
      var clone = t.cloneNode(true);
      return (clone.content.childNodes.length === 0 || clone.content.firstChild.content.childNodes.length === 0
        || brokenDocFragment);
    }
  })();

  var TEMPLATE_TAG = 'template';
  var PolyfilledHTMLTemplateElement = function() {};

  if (needsTemplate) {

    var contentDoc = document.implementation.createHTMLDocument('template');
    var canDecorate = true;

    var templateStyle = document.createElement('style');
    templateStyle.textContent = TEMPLATE_TAG + '{display:none;}';

    var head = document.head;
    head.insertBefore(templateStyle, head.firstElementChild);

    /**
      Provides a minimal shim for the <template> element.
    */
    PolyfilledHTMLTemplateElement.prototype = Object.create(HTMLElement.prototype);


    // if elements do not have `innerHTML` on instances, then
    // templates can be patched by swizzling their prototypes.
    var canProtoPatch =
      !(document.createElement('div').hasOwnProperty('innerHTML'));

    /**
      The `decorate` method moves element children to the template's `content`.
      NOTE: there is no support for dynamically adding elements to templates.
    */
    PolyfilledHTMLTemplateElement.decorate = function(template) {
      // if the template is decorated, return fast
      if (template.content) {
        return;
      }
      template.content = contentDoc.createDocumentFragment();
      var child;
      while ((child = template.firstChild)) {
        capturedAppendChild.call(template.content, child);
      }
      // NOTE: prefer prototype patching for performance and
      // because on some browsers (IE11), re-defining `innerHTML`
      // can result in intermittent errors.
      if (canProtoPatch) {
        template.__proto__ = PolyfilledHTMLTemplateElement.prototype;
      } else {
        template.cloneNode = function(deep) {
          return PolyfilledHTMLTemplateElement._cloneNode(this, deep);
        };
        // add innerHTML to template, if possible
        // Note: this throws on Safari 7
        if (canDecorate) {
          try {
            defineInnerHTML(template);
            defineOuterHTML(template);
          } catch (err) {
            canDecorate = false;
          }
        }
      }
      // bootstrap recursively
      PolyfilledHTMLTemplateElement.bootstrap(template.content);
    };

    var defineInnerHTML = function defineInnerHTML(obj) {
      Object.defineProperty(obj, 'innerHTML', {
        get: function() {
          var o = '';
          for (var e = this.content.firstChild; e; e = e.nextSibling) {
            o += e.outerHTML || escapeData(e.data);
          }
          return o;
        },
        set: function(text) {
          contentDoc.body.innerHTML = text;
          PolyfilledHTMLTemplateElement.bootstrap(contentDoc);
          while (this.content.firstChild) {
            capturedRemoveChild.call(this.content, this.content.firstChild);
          }
          while (contentDoc.body.firstChild) {
            capturedAppendChild.call(this.content, contentDoc.body.firstChild);
          }
        },
        configurable: true
      });
    };

    var defineOuterHTML = function defineOuterHTML(obj) {
      Object.defineProperty(obj, 'outerHTML', {
        get: function() {
          return '<' + TEMPLATE_TAG + '>' + this.innerHTML + '</' + TEMPLATE_TAG + '>';
        },
        set: function(innerHTML) {
          if (this.parentNode) {
            contentDoc.body.innerHTML = innerHTML;
            var docFrag = this.ownerDocument.createDocumentFragment();
            while (contentDoc.body.firstChild) {
              capturedAppendChild.call(docFrag, contentDoc.body.firstChild);
            }
            capturedReplaceChild.call(this.parentNode, docFrag, this);
          } else {
            throw new Error("Failed to set the 'outerHTML' property on 'Element': This element has no parent node.");
          }
        },
        configurable: true
      });
    };

    defineInnerHTML(PolyfilledHTMLTemplateElement.prototype);
    defineOuterHTML(PolyfilledHTMLTemplateElement.prototype);

    /**
      The `bootstrap` method is called automatically and "fixes" all
      <template> elements in the document referenced by the `doc` argument.
    */
    PolyfilledHTMLTemplateElement.bootstrap = function bootstrap(doc) {
      var templates = QSA(doc, TEMPLATE_TAG);
      for (var i=0, l=templates.length, t; (i<l) && (t=templates[i]); i++) {
        PolyfilledHTMLTemplateElement.decorate(t);
      }
    };

    // auto-bootstrapping for main document
    document.addEventListener('DOMContentLoaded', function() {
      PolyfilledHTMLTemplateElement.bootstrap(document);
    });

    // Patch document.createElement to ensure newly created templates have content
    Document.prototype.createElement = function createElement() {
      var el = capturedCreateElement.apply(this, arguments);
      if (el.localName === 'template') {
        PolyfilledHTMLTemplateElement.decorate(el);
      }
      return el;
    };

    var escapeDataRegExp = /[&\u00A0<>]/g;

    var escapeReplace = function escapeReplace(c) {
      switch (c) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '\u00A0':
          return '&nbsp;';
      }
    };

    var escapeData = function escapeData(s) {
      return s.replace(escapeDataRegExp, escapeReplace);
    };
  }

  // make cloning/importing work!
  if (needsTemplate || needsCloning) {

    PolyfilledHTMLTemplateElement._cloneNode = function _cloneNode(template, deep) {
      var clone = capturedCloneNode.call(template, false);
      // NOTE: decorate doesn't auto-fix children because they are already
      // decorated so they need special clone fixup.
      if (this.decorate) {
        this.decorate(clone);
      }
      if (deep) {
        // NOTE: use native clone node to make sure CE's wrapped
        // cloneNode does not cause elements to upgrade.
        capturedAppendChild.call(clone.content, capturedCloneNode.call(template.content, true));
        // now ensure nested templates are cloned correctly.
        fixClonedDom(clone.content, template.content);
      }
      return clone;
    };

    // Given a source and cloned subtree, find <template>'s in the cloned
    // subtree and replace them with cloned <template>'s from source.
    // We must do this because only the source templates have proper .content.
    var fixClonedDom = function fixClonedDom(clone, source) {
      // do nothing if cloned node is not an element
      if (!source.querySelectorAll) return;
      // these two lists should be coincident
      var s$ = QSA(source, TEMPLATE_TAG);
      if (s$.length === 0) {
        return;
      }
      var t$ = QSA(clone, TEMPLATE_TAG);
      for (var i=0, l=t$.length, t, s; i<l; i++) {
        s = s$[i];
        t = t$[i];
        if (PolyfilledHTMLTemplateElement && PolyfilledHTMLTemplateElement.decorate) {
          PolyfilledHTMLTemplateElement.decorate(s);
        }
        capturedReplaceChild.call(t.parentNode, cloneNode.call(s, true), t);
      }
    };

    // make sure scripts inside of a cloned template are executable
    var fixClonedScripts = function fixClonedScripts(fragment) {
      var scripts = QSA(fragment, scriptSelector);
      for (var ns, s, i = 0; i < scripts.length; i++) {
        s = scripts[i];
        ns = capturedCreateElement.call(document, 'script');
        ns.textContent = s.textContent;
        var attrs = s.attributes;
        for (var ai = 0, a; ai < attrs.length; ai++) {
          a = attrs[ai];
          ns.setAttribute(a.name, a.value);
        }
        capturedReplaceChild.call(s.parentNode, ns, s);
      }
    };

    // override all cloning to fix the cloned subtree to contain properly
    // cloned templates.
    var cloneNode = Node.prototype.cloneNode = function cloneNode(deep) {
      var dom;
      // workaround for Edge bug cloning documentFragments
      // https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/8619646/
      if (!needsDocFrag && brokenDocFragment && this instanceof DocumentFragment) {
        if (!deep) {
          return this.ownerDocument.createDocumentFragment();
        } else {
          dom = importNode.call(this.ownerDocument, this, true);
        }
      } else if (this.nodeType === Node.ELEMENT_NODE && this.localName === TEMPLATE_TAG) {
        dom = PolyfilledHTMLTemplateElement._cloneNode(this, deep);
      } else {
        dom = capturedCloneNode.call(this, deep);
      }
      // template.content is cloned iff `deep`.
      if (deep) {
        fixClonedDom(dom, this);
      }
      return dom;
    };

    // NOTE: we are cloning instead of importing <template>'s.
    // However, the ownerDocument of the cloned template will be correct!
    // This is because the native import node creates the right document owned
    // subtree and `fixClonedDom` inserts cloned templates into this subtree,
    // thus updating the owner doc.
    var importNode = Document.prototype.importNode = function importNode(element, deep) {
      deep = deep || false;
      if (element.localName === TEMPLATE_TAG) {
        return PolyfilledHTMLTemplateElement._cloneNode(element, deep);
      } else {
        var dom = capturedImportNode.call(this, element, deep);
        if (deep) {
          fixClonedDom(dom, element);
          fixClonedScripts(dom);
        }
        return dom;
      }
    };
  }

  if (needsTemplate) {
    window.HTMLTemplateElement = PolyfilledHTMLTemplateElement;
  }

})();
