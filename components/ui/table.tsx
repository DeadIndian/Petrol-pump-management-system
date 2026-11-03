import * as React from "react";

const Table = React.forwardRef<
	HTMLTableElement,
	React.HTMLAttributes<HTMLTableElement>
>(({ className = "", children, ...props }, ref) => {
    type Child = React.ReactElement<{ children?: React.ReactNode; "data-label"?: string }>;
    const contentText = (node: React.ReactNode): string => React.Children.toArray(node).map(item =>
        React.isValidElement(item) ? contentText((item as Child).props.children) : typeof item === "string" || typeof item === "number" ? String(item) : ""
    ).join(" ").trim();
    const header = React.Children.toArray(children).find(item => React.isValidElement(item) && item.type === TableHeader) as Child | undefined;
    const labels = header ? React.Children.toArray(header.props.children).flatMap(row =>
        React.isValidElement(row) ? React.Children.toArray((row as Child).props.children).map(cell => contentText(cell)) : []
    ) : [];
    const labelled = React.Children.map(children, item => {
        if (!React.isValidElement(item) || item.type !== TableBody) return item;
        return React.cloneElement(item as Child, {}, React.Children.map((item as Child).props.children, row => {
            if (!React.isValidElement(row) || row.type !== TableRow) return row;
            return React.cloneElement(row as Child, {}, React.Children.map((row as Child).props.children, (cell, index) =>
                React.isValidElement(cell) ? React.cloneElement(cell as Child, { "data-label": labels[index] }) : cell
            ));
        }));
    });
    return <div className="relative min-w-0 w-full overflow-x-auto">
        <table ref={ref} role="table" className={`responsive-table w-full caption-bottom text-sm ${className}`} {...props}>{labelled}</table>
    </div>;
});
Table.displayName = "Table";

const TableHeader = React.forwardRef<
	HTMLTableSectionElement,
	React.HTMLAttributes<HTMLTableSectionElement>
>(({ className = "", ...props }, ref) => (
	<thead ref={ref} className={`[&_tr]:border-b ${className}`} {...props} />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
	HTMLTableSectionElement,
	React.HTMLAttributes<HTMLTableSectionElement>
>(({ className = "", ...props }, ref) => (
	<tbody
		ref={ref}
		className={`[&_tr:last-child]:border-0 ${className}`}
		{...props}
	/>
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
	HTMLTableSectionElement,
	React.HTMLAttributes<HTMLTableSectionElement>
>(({ className = "", ...props }, ref) => (
	<tfoot
		ref={ref}
		className={`bg-gray-900 font-medium text-white ${className}`}
		{...props}
	/>
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<
	HTMLTableRowElement,
	React.HTMLAttributes<HTMLTableRowElement>
>(({ className = "", ...props }, ref) => (
	<tr
		ref={ref}
		className={`border-b transition-colors hover:bg-gray-50 data-[state=selected]:bg-gray-100 ${className}`}
		{...props}
	/>
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
	HTMLTableCellElement,
	React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className = "", ...props }, ref) => (
	<th
		ref={ref}
		className={`h-12 px-4 text-left align-middle font-medium text-gray-500 [&:has([role=checkbox])]:pr-0 ${className}`}
		{...props}
	/>
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className = "", children, ...props }, ref) => (
  <td ref={ref} className={`p-4 align-middle [&:has([role=checkbox])]:pr-0 ${className}`} {...props}>
    <div className="min-w-0">{children}</div>
  </td>
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
	HTMLTableCaptionElement,
	React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className = "", ...props }, ref) => (
	<caption
		ref={ref}
		className={`mt-4 text-sm text-gray-500 ${className}`}
		{...props}
	/>
));
TableCaption.displayName = "TableCaption";

export {
	Table,
	TableHeader,
	TableBody,
	TableFooter,
	TableHead,
	TableRow,
	TableCell,
	TableCaption,
};
