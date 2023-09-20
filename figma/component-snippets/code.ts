import * as snippetsJSON from "../../scripts/snippets/snippets.example.json";

type ParamsMap = {
  [k: string]: {
    TEXT?: string;
    BOOLEAN?: boolean;
    INSTANCE_SWAP?: string;
    VARIANT?: string;
  };
};
interface BasicObject {
  [k: string]: string;
}
type ParamsValues = BasicObject;
interface Snippet {
  name: string;
  props: {
    [k: string]: BasicObject | BasicObject[];
  };
  propTypes: BasicObject;
}

figma.codegen.on("generate", (event) => {
  return new Promise(async (resolve) => {
    const node = event.node;
    if (!isComponentNode(node)) {
      return resolve([
        {
          language: "PLAINTEXT",
          code: "Select a component",
          title: `Component Snippets`,
        },
      ]);
    }
    const snippets = getSnippets();
    const rawName =
      node.parent && node.parent.type === "COMPONENT_SET"
        ? node.parent.name
        : node.name;
    const name = capitalizedNameFromName(rawName);
    const snippet: Snippet = snippets[name];
    if (snippet) {
      const params = await paramsFromNode(node);
      resolve(codegenResult(snippet, params, name));
    } else {
      resolve([
        {
          language: "PLAINTEXT",
          code: "No snippets found",
          title: `Component Snippets`,
        },
      ]);
    }
  });
});

async function paramsFromNode(
  node: ComponentNode | ComponentSetNode | InstanceNode
) {
  const nodeToProcess =
    node.type === "COMPONENT"
      ? node.parent && node.parent.type === "COMPONENT_SET"
        ? node.parent
        : node
      : node;
  const valueObject: ComponentProperties | ComponentPropertyDefinitions =
    nodeToProcess.type === "INSTANCE"
      ? nodeToProcess.componentProperties
      : nodeToProcess.componentPropertyDefinitions;
  const object: ParamsMap = {};
  const isDefinitions = isComponentPropertyDefinitions(valueObject);
  for (let propertyName in valueObject) {
    const value = isDefinitions
      ? valueObject[propertyName].defaultValue
      : valueObject[propertyName].value;
    const type = valueObject[propertyName].type;
    const cleanName = sanitizePropertyName(propertyName);
    if (value !== undefined) {
      object[cleanName] = object[cleanName] || {};
      if (isString(value)) {
        if (type === "VARIANT") object[cleanName].VARIANT = value;
        if (type === "TEXT") object[cleanName].TEXT = value;
        if (type === "INSTANCE_SWAP") {
          const foundNode = await figma.getNodeById(value);
          object[cleanName].INSTANCE_SWAP = capitalizedNameFromName(
            foundNode ? foundNode.name : ""
          );
        }
      } else {
        object[cleanName].BOOLEAN = value;
      }
    }
  }
  const params: ParamsValues = {};
  const types: ComponentPropertyType[] = ["TEXT", "VARIANT", "INSTANCE_SWAP"];
  for (let key in object) {
    const item = object[key];
    const hasBoolean = "BOOLEAN" in item;
    const booleanCheck = !hasBoolean || item.BOOLEAN;
    let value: string | boolean | undefined;
    types.forEach((type) => {
      if (type in item) {
        if (booleanCheck) {
          value =
            type === "VARIANT" ? optionNameFromVariant(item[type]) : item[type];
        } else {
          value = "undefined";
        }
      }
    });
    if (value === undefined && hasBoolean) {
      value = item.BOOLEAN;
    }
    params[`@${key}`] = (value || "").toString() || "";
  }
  return params;
}

function optionNameFromVariant(name: string = "") {
  const clean = name.replace(/[^a-zA-Z\d-_ ]/g, "");
  if (clean.match("-")) {
    return clean.replace(/ +/g, "-").toLowerCase();
  } else if (clean.match("_")) {
    return clean.replace(/ +/g, "_").toLowerCase();
  } else if (clean.match(" ") || clean.match(/^[A-Z]/)) {
    return clean
      .split(/ +/)
      .map((a, i) => {
        let text =
          i > 0
            ? `${a.charAt(0).toUpperCase()}${a.substring(1).toLowerCase()}`
            : a.toLowerCase();
        return text;
      })
      .join("");
  } else return clean;
}

function codegenResult(
  { name: tagName, props, propTypes }: Snippet,
  params: ParamsValues,
  name: string
): CodegenResult[] {
  const result: CodegenResult[] = [];

  for (let title in props) {
    let code = "";
    const propObject = props[title];
    if (Array.isArray(propObject)) {
      const arr: string[] = [];
      propObject.forEach((object) => {
        const children =
          "children" in object ? formatValue(object.children, params) : null;
        arr.push(formatInstance(tagName, object, propTypes, params, children));
      });
      code = arr.join("\n");
    } else {
      const children =
        "children" in propObject
          ? formatValue(propObject.children, params)
          : null;
      code = formatInstance(tagName, propObject, propTypes, params, children);
    }
    result.push({
      language: "JAVASCRIPT",
      code,
      title: `${name}: ${title}`,
    });
  }

  return result;
}

function formatValue(rawValue: string, params: ParamsValues): string | null {
  let value = rawValue;
  for (let p in params) {
    value =
      value.match(p) && params[p] === "undefined"
        ? "undefined"
        : value.replace(new RegExp(p, "g"), params[p]);
  }
  const ternary = value.match(/^(.+)=(.+)\?(.+):(.+)$/);
  if (ternary) {
    const [_, param, val, truthy, falsey] = ternary;
    value = param === val ? truthy : falsey;
  }

  return value !== "undefined" ? value : null;
}

function renderProps(
  props: BasicObject,
  propTypes: BasicObject,
  params: ParamsValues
) {
  const propsArr = [];
  for (let propName in props) {
    if (propName !== "children") {
      const type = propTypes[propName] || propTypes["*"] || "string";
      const value = formatValue(props[propName], params);
      if (value !== null) {
        propsArr.push(
          `  ${propName}=` + (type === "string" ? `"${value}"` : `{${value}}`)
        );
      }
    }
  }
  return propsArr;
}

function isComponentPropertyDefinitions(
  object: ComponentProperties | ComponentPropertyDefinitions
): object is ComponentPropertyDefinitions {
  const key = Object.keys(object)[0];
  return "defaultValue" in object[key];
}

function isComponentNode(
  node: SceneNode
): node is ComponentNode | ComponentSetNode | InstanceNode {
  return (
    node.type === "COMPONENT" ||
    node.type === "COMPONENT_SET" ||
    node.type === "INSTANCE"
  );
}

function isString(value: string | boolean): value is string {
  return value.toString() === value;
}

function getSnippets(): { [k: string]: Snippet } {
  return JSON.parse(JSON.stringify(snippetsJSON));
}

function capitalize(name: string) {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function downcase(name: string) {
  return `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}
function numericGuard(name: string) {
  if (name.charAt(0).match(/\d/)) {
    name = `N${name}`;
  }
  return name;
}
function capitalizedNameFromName(name: string) {
  name = numericGuard(name);
  return name
    .split(/[^a-zA-Z\d]+/g)
    .map(capitalize)
    .join("");
}

function sanitizePropertyName(name: string) {
  name = name.replace(/#[^#]+$/g, "");
  return downcase(capitalizedNameFromName(name).replace(/^\d+/g, ""));
}

function formatInstance(
  tagName: string,
  object: BasicObject,
  propTypes: BasicObject,
  params: ParamsValues,
  children: string | null
) {
  const singleLine = Object.keys(object).length <= 3;
  const array = [`<${tagName}`, ...renderProps(object, propTypes, params)];
  if (children) {
    array.push(">", `  ${children}`, `</${tagName}>`);
  } else {
    array.push("/>");
  }
  return array.join(singleLine ? " " : "\n");
}
