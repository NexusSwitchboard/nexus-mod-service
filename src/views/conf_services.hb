<p><b>Important</b>: This document automatically updates itself every day using data stored in <a
        href="https://app.opslevel.com">OpsLevel</a>. Any changes you need to make, please make them there. </p>

<table>
    <thead>
    <tr>
        <th>Name</th>
        <th>Description</th>
        <th>Product</th>
        <th>Owner</th>
    </tr>
    </thead>
    <tbody>
    {{#each services}}
        <tr>
            <td><a target="_blank" href="https://app.opslevel.com/services/{{alias}}">{{name}}</a></td>
            <td>{{description}}</td>
            <td>{{product}}</td>
            <td>{{owner.name}}</td>
        </tr>
    {{/each}}
    </tbody>
</table>
