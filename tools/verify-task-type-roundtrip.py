"""API integration check against a disposable repository; Python standard library only."""
import io
import json
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'backend/ProcessNavigator.Api/Data'
DLL = ROOT / 'backend/ProcessNavigator.Api/bin/Debug/net9.0/ProcessNavigator.Api.dll'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
M = '{' + NS['m'] + '}'


def workbook_rows(content):
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        document = ET.fromstring(archive.read('xl/worksheets/sheet3.xml'))
    rows = document.findall('.//m:sheetData/m:row', NS)
    values = lambda row: {''.join(filter(str.isalpha, cell.attrib['r'])): cell.findtext('m:v', default='', namespaces=NS) for cell in row}
    headers = values(next(row for row in rows if row.attrib['r'] == '3'))
    return document, rows, headers, values


def edit_workbook(content, changes=None, legacy=False, legacy_executor=False):
    document, rows, headers, values = workbook_rows(content)
    columns = {name: column for column, name in headers.items()}
    extra = {columns[name] for name in (('Тип BPMN', 'Способ выполнения', 'Система выполнения', 'Инструкция', 'Исполнитель действия') if legacy else ('Исполнитель действия',))}
    retained_columns = 26 if legacy else 30
    for row in rows:
        current = values(row)
        step = current.get(columns['ID шага'])
        for name, value in (changes or {}).get(step, {}).items():
            column = columns[name]
            cell = next((cell for cell in row if cell.attrib['r'] == column + row.attrib['r']), None)
            if cell is None:
                cell = ET.SubElement(row, M + 'c', {'r': column + row.attrib['r']})
            cell.clear()
            cell.attrib.update({'r': column + row.attrib['r'], 't': 'str'})
            ET.SubElement(cell, M + 'v').text = value
        if legacy or legacy_executor:
            for cell in list(row):
                if ''.join(filter(str.isalpha, cell.attrib['r'])) in extra:
                    row.remove(cell)
    output = io.BytesIO()
    if legacy or legacy_executor:
        dimension = document.find('m:dimension', NS)
        last_column = 'Z' if legacy else 'AD'
        last_row = ''.join(filter(str.isdigit, dimension.attrib['ref'].split(':')[-1]))
        dimension.set('ref', f'A1:{last_column}{last_row}')
        columns_node = document.find('m:cols', NS)
        for column in list(columns_node):
            if int(column.attrib['min']) > retained_columns:
                columns_node.remove(column)
    with zipfile.ZipFile(io.BytesIO(content)) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as result:
        for info in source.infolist():
            payload = source.read(info.filename)
            if (legacy or legacy_executor) and info.filename == 'xl/workbook.xml':
                old_book = ET.fromstring(payload)
                sheets = old_book.find('m:sheets', NS)
                for sheet in list(sheets):
                    if sheet.attrib.get('name') in ('Основания', 'Сверка'):
                        sheets.remove(sheet)
                payload = ET.tostring(old_book, encoding='utf-8', xml_declaration=True)
            if info.filename == 'xl/worksheets/sheet3.xml':
                payload = ET.tostring(document, encoding='utf-8', xml_declaration=True)
            if (legacy or legacy_executor) and info.filename == 'xl/tables/table2.xml':
                table = ET.fromstring(payload)
                last_row = ''.join(filter(str.isdigit, table.attrib['ref'].split(':')[-1]))
                table.set('ref', f'A3:{last_column}{last_row}')
                auto_filter = table.find('m:autoFilter', NS)
                if auto_filter is not None:
                    auto_filter.set('ref', table.attrib['ref'])
                table_columns = table.find('m:tableColumns', NS)
                for column in list(table_columns)[retained_columns:]:
                    table_columns.remove(column)
                table_columns.set('count', str(retained_columns))
                payload = ET.tostring(table, encoding='utf-8', xml_declaration=True)
            result.writestr(info, payload)
    return output.getvalue()


def rewrite_evidence(content, invalid=False, clone=False, requirements_mode=None, rename=None):
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(content)) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            payload = source.read(info.filename)
            if info.filename.startswith('xl/worksheets/') and info.filename.endswith('.xml'):
                document = ET.fromstring(payload)
                if rename:
                    for value in document.findall('.//m:v', NS):
                        value.text = ' | '.join(rename.get(part.strip(), part.strip()) for part in (value.text or '').split('|'))
                if clone:
                    for value in document.findall('.//m:v', NS):
                        if (value.text or '').startswith('demo-showcase-'):
                            value.text = (clone if isinstance(clone, str) else 'copy-') + value.text
                if requirements_mode and info.filename == 'xl/worksheets/requirements.xml':
                    data = document.find('m:sheetData', NS)
                    if requirements_mode == 'empty':
                        for row in list(data):
                            if int(row.attrib['r']) > 3:
                                data.remove(row)
                    elif requirements_mode == 'badsource':
                        document.find('.//m:c[@r="E4"]/m:v', NS).text = ''
                    elif requirements_mode == 'stale':
                        document.find('.//m:c[@r="G4"]/m:v', NS).text = 'nonexistent-node | Task_ReceiptOrder'
                    elif requirements_mode == 'legacy-route':
                        for row in data:
                            for cell in list(row):
                                if ''.join(filter(str.isalpha, cell.attrib['r'])) == 'H':
                                    row.remove(cell)
                    elif requirements_mode == 'duplicate':
                        duplicate = ET.fromstring(ET.tostring(data.find('m:row[@r="4"]', NS)))
                        duplicate.set('r', '99')
                        for cell in duplicate:
                            cell.set('r', ''.join(filter(str.isalpha, cell.attrib['r'])) + '99')
                        data.append(duplicate)
                if invalid and info.filename == 'xl/worksheets/evidence.xml':
                    for cell in document.findall('.//m:c', NS):
                        if cell.attrib.get('r') == 'F4':
                            cell.find('m:v', NS).text = ''
                payload = ET.tostring(document, encoding='utf-8', xml_declaration=True)
            if requirements_mode == 'legacy-route' and info.filename == 'xl/tables/requirements.xml':
                table = ET.fromstring(payload)
                columns = table.find('m:tableColumns', NS)
                for column in list(columns)[7:]:
                    columns.remove(column)
                columns.set('count', '7')
                table.set('ref', table.attrib['ref'].replace(':H', ':G'))
                auto_filter = table.find('m:autoFilter', NS)
                if auto_filter is not None:
                    auto_filter.set('ref', table.attrib['ref'])
                payload = ET.tostring(table, encoding='utf-8', xml_declaration=True)
            target.writestr(info, payload)
    return output.getvalue()


def check():
    if not DLL.exists():
        raise RuntimeError('Build the API first: dotnet build backend/ProcessNavigator.Api')
    with tempfile.TemporaryDirectory(prefix='pn-task-types-') as directory:
        temporary = pathlib.Path(directory)
        target = temporary / 'Data'
        target.mkdir()
        for source in DATA.iterdir():
            if source.is_file() and (source.suffix == '.bpmn' or source.name.endswith('.context.json') or source.name == 'organization.json'):
                shutil.copy2(source, target / source.name)
        shutil.copytree(DATA / 'Templates', target / 'Templates')
        if (DATA / 'InformationObjects').exists():
            shutil.copytree(DATA / 'InformationObjects', target / 'InformationObjects')
        # Legacy contexts omit executorKind; derive only from explicit BPMN semantics, not channels.
        warehouse_context_path = target / 'demo-showcase-l3-warehouse.context.json'
        old_context = json.loads(warehouse_context_path.read_text(encoding='utf-8'))
        for element in old_context['elements'].values():
            element.pop('executorKind', None)
        warehouse_context_path.write_text(json.dumps(old_context, ensure_ascii=False), encoding='utf-8')
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        def request(route, content=None, raw=False, expect=200, body=None, method=None, form_fields=None):
            headers = {'X-Process-Navigator-Role': 'superadministrator'}
            if content is not None:
                boundary = 'pn-type-roundtrip-boundary'
                headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
                fields = ''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n' for key, value in (form_fields or {}).items()).encode()
                content = (fields + f'--{boundary}\r\nContent-Disposition: form-data; name="tableFile"; filename="types.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'.encode() + content + f'\r\n--{boundary}--\r\n'.encode())
            if body is not None:
                headers['Content-Type'] = 'application/json'
                content = json.dumps(body, ensure_ascii=False).encode('utf-8')
            try:
                response = urllib.request.urlopen(urllib.request.Request(base + route, data=content, headers=headers, method=method), timeout=30)
            except urllib.error.HTTPError as error:
                response = error
            payload = response.read()
            assert response.code == expect, (route, response.code, payload.decode('utf-8')[:1200])
            return payload if raw else json.loads(payload)

        with (temporary / 'server.log').open('w', encoding='utf-8') as log:
            server = subprocess.Popen(['dotnet', str(DLL), '--contentRoot', str(temporary), '--urls', base], stdout=log, stderr=log)
            try:
                for _ in range(100):
                    if server.poll() is not None:
                        raise RuntimeError((temporary / 'server.log').read_text(encoding='utf-8')[-1800:])
                    try:
                        request('/api/processes')
                        break
                    except (OSError, urllib.error.URLError):
                        time.sleep(0.1)
                else:
                    raise RuntimeError('Temporary API did not start.')
                route = '/api/processes/demo-showcase-l3-warehouse'
                before = request(route)
                service = next(node for node in before['nodes'] if node['id'] == 'Task_SystemNotice')
                assert service['type'] == 'task' and service['bpmnType'] == 'serviceTask'
                assert service['executorKind'] == 'system'
                assert next(node for node in before['nodes'] if node['id'] == 'Task_ReceiptOrder')['executorKind'] == 'human'
                before_organization = request('/api/organization')
                book = request('/api/processes/demo-showcase-l0/table-export?includeDescendants=true', raw=True)
                _, _, headers, _ = workbook_rows(book)
                assert all(name in headers.values() for name in ('Тип BPMN', 'Способ выполнения', 'Система выполнения', 'Инструкция', 'Исполнитель действия'))
                types = {'Task_PhysicalReceipt': 'manualTask', 'Task_ReceiptOrder': 'userTask', 'Task_SystemNotice': 'serviceTask', 'Task_Accounting': 'businessRuleTask', 'Task_CalculateNeeds': 'sendTask', 'Task_PaymentControl': 'receiveTask'}
                changes = {step: {'Тип BPMN': kind} for step, kind in types.items()}
                changes['Task_SystemNotice'].update({'Способ выполнения': 'system', 'Система выполнения': 'ERP integration test', 'Инструкция': 'Record a verified notification result.'})
                changes['Task_SystemNotice']['Исполнитель действия'] = 'system'
                changes['Task_ReceiptOrder'].update({'Исполнитель действия': 'human', 'Способ выполнения': 'system', 'Система выполнения': 'ERP integration test'})
                changes['Task_CalculateNeeds']['Исполнитель действия'] = 'human'
                edited = edit_workbook(book, changes)
                preview = request('/api/processes/table-preview', edited)
                errors = [issue for issue in preview['issues'] if issue['severity'] == 'Error']
                assert not errors, errors
                request('/api/processes/table-import', edited)
                after = request(route + '?draft=true')
                for node in after['nodes']:
                    if node['id'] in types:
                        assert node['bpmnType'] == types[node['id']], node
                        old = next(item for item in before['nodes'] if item['id'] == node['id'])
                        assert (node['x'], node['y'], node['width'], node['height']) == (old['x'], old['y'], old['width'], old['height'])
                notice = next(node for node in after['nodes'] if node['id'] == 'Task_SystemNotice')
                assert (notice['executionMode'], notice['systemName'], notice['instruction']) == ('system', 'ERP integration test', 'Record a verified notification result.')
                assert notice['executorKind'] == 'system'
                human = next(node for node in after['nodes'] if node['id'] == 'Task_ReceiptOrder')
                assert (human['executorKind'], human['executionMode'], human['systemName']) == ('human', 'system', 'ERP integration test')
                context_route = route + '/draft/elements/Task_SystemNotice/context'
                changed_executor = request(context_route, body=notice | {'executorKind': 'human'}, method='PUT')
                assert changed_executor['executorKind'] == 'human' and changed_executor['laneId'] == notice['laneId']
                request(context_route, body=notice | {'executorKind': 'root'}, method='PUT', expect=422)
                restored_executor = request(context_route, body=notice, method='PUT')
                assert restored_executor['executorKind'] == 'system'
                after_organization = request('/api/organization')
                assert before_organization['legalEntities'] == after_organization['legalEntities']
                bindings = lambda organization: sorted((item['processId'], lane['laneId'], lane['legalEntityId'], lane['unitId']) for item in organization['crossCompanyProcesses'] for lane in item['laneOrganizations'])
                assert bindings(before_organization) == bindings(after_organization)
                procurement = request('/api/processes/demo-showcase-l2-procurement?draft=true')
                assert all(next(node for node in procurement['nodes'] if node['id'] == step)['bpmnType'] == types[step] for step in ('Task_CalculateNeeds', 'Task_PaymentControl'))
                again = request('/api/processes/demo-showcase-l0/table-export?includeDescendants=true', raw=True)
                request('/api/processes/table-import', edit_workbook(again, legacy=True))
                legacy = request(route + '?draft=true')
                assert [(node['id'], node['bpmnType'], node['executionMode'], node['systemName'], node['instruction']) for node in legacy['nodes']] == [(node['id'], node['bpmnType'], node['executionMode'], node['systemName'], node['instruction']) for node in after['nodes']]
                assert [(node['id'], node['executorKind']) for node in legacy['nodes']] == [(node['id'], node['executorKind']) for node in after['nodes']]
                request('/api/processes/table-import', edit_workbook(again, legacy_executor=True))
                assert next(node for node in request('/api/processes/demo-showcase-l2-procurement?draft=true')['nodes'] if node['id'] == 'Task_CalculateNeeds')['executorKind'] == 'human'
                bad_executor = edit_workbook(again, {'Task_SystemNotice': {'Исполнитель действия': 'unrestricted'}})
                assert any(issue['column'] == 'Исполнитель действия' and issue['severity'] == 'Error' for issue in request('/api/processes/table-preview', bad_executor)['issues'])
                request('/api/processes/table-import', bad_executor, expect=422)
                invalid = edit_workbook(again, {'Task_SystemNotice': {'Тип BPMN': 'scriptTask'}})
                assert any(issue['column'] == 'Тип BPMN' and issue['severity'] == 'Error' for issue in request('/api/processes/table-preview', invalid)['issues'])
                request('/api/processes/table-import', invalid, expect=422)
                assert request(route + '?draft=true') == legacy
                cleared = edit_workbook(again, {'Task_SystemNotice': {'Способ выполнения': '', 'Система выполнения': '', 'Инструкция': ''}})
                request('/api/processes/table-import', cleared)
                clear_node = next(node for node in request(route + '?draft=true')['nodes'] if node['id'] == 'Task_SystemNotice')
                assert not clear_node['executionMode'] and not clear_node['systemName'] and not clear_node['instruction']
                assert clear_node['bpmnType'] == 'serviceTask'
                missing_system = request(route + '/draft/validation')
                assert any(issue['code'] == 'executor-system-missing' for issue in missing_system['issues'])
                conflicting = edit_workbook(again, {'Task_SystemNotice': {'Исполнитель действия': 'human'}})
                assert any(issue['column'] == 'Исполнитель действия' and issue['severity'] == 'Warning' for issue in request('/api/processes/table-preview', conflicting)['issues'])
                request('/api/processes/table-import', conflicting)
                assert any(issue['code'] == 'executor-type-conflict' for issue in request(route + '/draft/validation')['issues'])
                # Provenance survives context saves and table updates, including legacy books.
                current_notice = next(node for node in request(route + '?draft=true')['nodes'] if node['id'] == 'Task_SystemNotice')
                evidence = [{'status': 'fact', 'statement': 'Synthetic integration fixture', 'source': 'test fixture', 'locator': 'row 1', 'author': 'test'},
                            {'status': 'question', 'statement': 'Confirm delivery channel', 'source': None, 'locator': None, 'author': None}]
                saved = request(context_route, body=current_notice | {'evidence': evidence}, method='PUT')
                assert saved['evidence'] == evidence
                for invalid_evidence in ([{'status': 'fact', 'statement': 'No source'}], [{'status': 'unknown', 'statement': 'Bad status'}], [{'status': 'question', 'statement': ''}], evidence * 11):
                    request(context_route, body=current_notice | {'evidence': invalid_evidence}, method='PUT', expect=422)
                assert next(node for node in request(route + '?draft=true')['nodes'] if node['id'] == 'Task_SystemNotice')['evidence'] == evidence
                assert any(issue['code'] == 'task-evidence-unresolved' for issue in request(route + '/draft/validation')['issues'])
                request('/api/processes/table-import', edit_workbook(again, legacy=True))
                assert next(node for node in request(route + '?draft=true')['nodes'] if node['id'] == 'Task_SystemNotice')['evidence'] == evidence
                evidence_book = request('/api/processes/demo-showcase-l0/table-export?includeDescendants=true', raw=True)
                invalid_evidence_book = rewrite_evidence(evidence_book, invalid=True)
                assert any(issue['sheet'] == 'Основания' and issue['severity'] == 'Error' for issue in request('/api/processes/table-preview', invalid_evidence_book)['issues'])
                request('/api/processes/table-import', invalid_evidence_book, expect=422)
                request('/api/processes/table-import', rewrite_evidence(evidence_book, clone=True))
                assert next(node for node in request('/api/processes/copy-demo-showcase-l3-warehouse?draft=true')['nodes'] if node['id'] == 'Task_SystemNotice')['evidence'] == evidence
                request(context_route, body=current_notice | {'evidence': []}, method='PUT')
                assert not next(node for node in request(route + '?draft=true')['nodes'] if node['id'] == 'Task_SystemNotice')['evidence']
                request('/api/processes/table-import', evidence_book)
                assert next(node for node in request(route + '?draft=true')['nodes'] if node['id'] == 'Task_SystemNotice')['evidence'] == evidence
                with zipfile.ZipFile(io.BytesIO(evidence_book)) as archive:
                    evidence_xml = ET.fromstring(archive.read('xl/worksheets/evidence.xml'))
                    assert 'Synthetic integration fixture' in ET.tostring(evidence_xml, encoding='unicode')
                    assert evidence_xml.find('m:dataValidations/m:dataValidation', NS) is not None
                    table = ET.fromstring(archive.read('xl/tables/evidence.xml'))
                    assert len(table.find('m:tableColumns', NS)) == 8
                    for name in archive.namelist():
                        if name.endswith('.xml') or name.endswith('.rels'):
                            ET.fromstring(archive.read(name))
                with zipfile.ZipFile(io.BytesIO(request('/api/processes/table-template', raw=True))) as template:
                    assert 'xl/worksheets/evidence.xml' in template.namelist()
                request('/api/processes/table-import', again)
                assert next(node for node in request(route + '?draft=true')['nodes'] if node['id'] == 'Task_SystemNotice')['evidence'] == current_notice['evidence']
                # Source-description requirements persist independently from step evidence.
                model = request(route + '?draft=true')
                requirements = [{'id': 'r1', 'text': 'Inspect the delivery', 'source': 'synthetic source', 'locator': 'row 1', 'elementIds': ['Task_PhysicalReceipt', 'Task_ReceiptOrder'], 'checkSequence': True},
                                {'id': 'r2', 'text': 'Pending mapping', 'source': 'synthetic source', 'locator': None, 'elementIds': [], 'checkSequence': False}]
                properties = {'owner': model['owner'], 'ownerLegalEntityId': model['ownerLegalEntityId'], 'ownerUnitId': model['ownerUnitId'], 'passport': model['passport'] | {'sourceRequirements': requirements}}
                request(route + '/draft/properties', body=properties, method='PUT')
                assert request(route + '?draft=true')['passport']['sourceRequirements'] == requirements
                assert any(issue['code'] == 'process-source-unmapped' for issue in request(route + '/draft/validation')['issues'])
                broken_requirements = [requirements[0] | {'elementIds': ['missing-element'], 'checkSequence': False}]
                request(route + '/draft/properties', body=properties | {'passport': model['passport'] | {'sourceRequirements': broken_requirements}}, method='PUT')
                assert any(issue['code'] == 'process-source-stale' for issue in request(route + '/draft/validation')['issues'])
                request(route + '/draft/properties', body=properties, method='PUT')
                reversed_requirements = [requirements[0] | {'elementIds': ['Task_ReceiptOrder', 'Task_PhysicalReceipt']}]
                request(route + '/draft/properties', body=properties | {'passport': model['passport'] | {'sourceRequirements': reversed_requirements}}, method='PUT')
                assert any(issue['code'] == 'process-source-route' for issue in request(route + '/draft/validation')['issues'])
                request(route + '/draft/properties', body=properties, method='PUT')
                assert not any(issue['code'] == 'process-source-route' for issue in request(route + '/draft/validation')['issues'])
                for invalid_requirements in ([requirements[0], requirements[0]], [requirements[0] | {'source': ''}], [requirements[0] | {'elementIds': ['x'] * 21}]):
                    request(route + '/draft/properties', body=properties | {'passport': model['passport'] | {'sourceRequirements': invalid_requirements}}, method='PUT', expect=422)
                assert request(route + '?draft=true')['passport']['sourceRequirements'] == requirements
                request('/api/processes/table-import', edit_workbook(again, legacy=True))
                assert request(route + '?draft=true')['passport']['sourceRequirements'] == requirements
                requirement_book = request('/api/processes/demo-showcase-l0/table-export?includeDescendants=true', raw=True)
                request('/api/processes/table-import', rewrite_evidence(requirement_book, requirements_mode='legacy-route'))
                assert request(route + '?draft=true')['passport']['sourceRequirements'] == requirements
                for mode in ('badsource', 'duplicate'):
                    invalid_book = rewrite_evidence(requirement_book, requirements_mode=mode)
                    assert any(issue['sheet'] == 'Сверка' and issue['severity'] == 'Error' for issue in request('/api/processes/table-preview', invalid_book)['issues'])
                    request('/api/processes/table-import', invalid_book, expect=422)
                    assert request(route + '?draft=true')['passport']['sourceRequirements'] == requirements
                request('/api/processes/table-import', rewrite_evidence(requirement_book, clone='fresh-'))
                assert request('/api/processes/fresh-demo-showcase-l3-warehouse?draft=true')['passport']['sourceRequirements'] == requirements
                stale_book = rewrite_evidence(requirement_book, requirements_mode='stale')
                assert any(issue['sheet'] == 'Сверка' and issue['severity'] == 'Warning' for issue in request('/api/processes/table-preview', stale_book)['issues'])
                request('/api/processes/table-import', rewrite_evidence(requirement_book, requirements_mode='empty'))
                assert not request(route + '?draft=true')['passport']['sourceRequirements']
                preview_requirements = request('/api/processes/table-preview', requirement_book)
                assert any('Сверка' in change.get('field', '') for item in preview_requirements['processes'] for change in item.get('fieldChanges', []))
                request('/api/processes/table-import', requirement_book)
                assert request(route + '?draft=true')['passport']['sourceRequirements'] == requirements
                renamed_book = rewrite_evidence(requirement_book, rename={'Task_PhysicalReceipt': 'Task_RenamedReceipt'})
                mapping = [{'processId': 'demo-showcase-l3-warehouse', 'incomingStepId': 'Task_RenamedReceipt', 'existingStepId': 'Task_PhysicalReceipt'}]
                request('/api/processes/table-import', renamed_book, form_fields={'stepIdMappings': json.dumps(mapping)})
                assert request(route + '?draft=true')['passport']['sourceRequirements'] == requirements
                # A legacy book must not flatten the contents/parameters of an existing compound node.
                draft_path = target / 'Drafts/demo-showcase-l3-warehouse.bpmn'
                compound_xml = draft_path.read_text(encoding='utf-8').replace('userTask', 'callActivity')
                draft_path.write_text(compound_xml, encoding='utf-8')
                complex_book = request('/api/processes/demo-showcase-l0/table-export?includeDescendants=true', raw=True)
                complex_preview = request('/api/processes/table-preview', edit_workbook(complex_book, legacy=True))
                assert any(issue['column'] == 'Тип BPMN' and issue['severity'] == 'Error' for issue in complex_preview['issues'])
                request('/api/processes/table-import', edit_workbook(complex_book, legacy=True), expect=422)
                assert draft_path.read_text(encoding='utf-8') == compound_xml
                print('PASS: BPMN/executor; evidence and source-requirement transfer; legacy preservation; invalid-data rejection; clearing; preview; renamed-step mapping; template XML; compound protection.')
            finally:
                server.terminate()
                server.wait(timeout=15)


if __name__ == '__main__':
    check()
