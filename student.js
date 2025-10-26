var selectedRow = null;
var selectedRow = null;

function resetForm() {
    document.getElementById("username").value = "";
    document.getElementById("rollNo").value = "";
    document.getElementById("stdClass").value = "";
    document.getElementById("tnum").value = "";
    document.getElementById("age").value = "";
    selectedRow = null;
}
function onFormSubmit(){
    if(validate()){
        var formData = readFormData();
        if(selectedRow == null){
            insertNewRecord(formData);
        }
        else{
            updateRecord(formData);
        }
        resetForm();
    }
}

function readFormData(){
    var formData = {};
    formData["username"] = document.getElementById("username").value; 
    formData["rollNo"] = document.getElementById("rollNo").value;
    formData["stdClass"] = document.getElementById("stdClass").value;
    formData["tnum"] = document.getElementById("tnum").value;
    formData["age"] = document.getElementById("age").value;
    return formData;
}

function insertNewRecord(data){
    var table = document.getElementById("stdlist").getElementsByTagName("tbody")[0];
    var newRow = table.insertRow(table.length);
    cell1 = newRow.insertCell(0);
    cell1.innerHTML = data.username; 
    cell1 = newRow.insertCell(1);
    cell1.innerHTML = data.rollNo;
    cell1 = newRow.insertCell(2);
    cell1.innerHTML = data.stdClass;
    cell1 = newRow.insertCell(3);
    cell1.innerHTML = data.tnum;
    cell1 = newRow.insertCell(4);
    cell1.innerHTML = data.age;
    cell1 = newRow.insertCell(5);
    cell1.innerHTML = `<a onClick="onEdit(this)">Edit</a><a onClick="onDelete(this)">Delete</a>`;
}

function onEdit(td){
    selectedRow = td.parentElement.parentElement;
    document.getElementById("username").value = selectedRow.cells[0].innerHTML; 
    document.getElementById("rollNo").value = selectedRow.cells[1].innerHTML;
    document.getElementById("stdClass").value = selectedRow.cells[2].innerHTML;
    document.getElementById("tnum").value = selectedRow.cells[3].innerHTML;
    document.getElementById("age").value = selectedRow.cells[4].innerHTML;
}

function updateRecord(formData){
    selectedRow.cells[0].innerHTML = formData.username; 
    selectedRow.cells[1].innerHTML = formData.rollNo;
    selectedRow.cells[2].innerHTML = formData.stdClass;
    selectedRow.cells[3].innerHTML = formData.tnum;
    selectedRow.cells[4].innerHTML = formData.age;
}

function onDelete(td){
    if(confirm('Are you sure to delete this record ?')){
        row = td.parentElement.parentElement;
        document.getElementById("stdlist").deleteRow(row.rowIndex);
        resetForm();
    }
}


function validate(){
    var isValid = true;

    if(document.getElementById("username").value ==""){
        isValid = false;
        document.getElementById("userNamevalidationError").classList.remove("hide");
    }
    else{
        if(!document.getElementById("userNamevalidationError").classList.contains("hide")) {
            document.getElementById("userNamevalidationError").classList.add("hide");
        }
    }

    if(document.getElementById("rollNo").value ==""){
        isValid = false;
        document.getElementById("rollNovalidationError").classList.remove("hide");
    }
    else{
        if(!document.getElementById("rollNovalidationError").classList.contains("hide")) {
            document.getElementById("rollNovalidationError").classList.add("hide");
        }
    }

    if(document.getElementById("stdClass").value ==""){
        isValid = false;
        document.getElementById("stdClassvalidationError").classList.remove("hide");
    }
    else{
        if(!document.getElementById("stdClassvalidationError").classList.contains("hide")) {
            document.getElementById("stdClassvalidationError").classList.add("hide");
        }
    }

    if(document.getElementById("tnum").value ==""){
        isValid = false;
        document.getElementById("tnumvalidationError").classList.remove("hide");
    }
    else{
        if(!document.getElementById("tnumvalidationError").classList.contains("hide")) {
            document.getElementById("tnumvalidationError").classList.add("hide");
        }
    }

    if(document.getElementById("age").value ==""){
        isValid = false;
        document.getElementById("agevalidationError").classList.remove("hide");
    }
    else{
        if(!document.getElementById("agevalidationError").classList.contains("hide")) {
            document.getElementById("agevalidationError").classList.add("hide");
        }
    }

    return isValid;
}
