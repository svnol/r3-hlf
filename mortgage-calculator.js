    let freq = 52, freqName = "Weekly", calcMode = 'buy', complexity = 'simple', isTrueCost = false;
    let tranches = [{ id: 1, amount: 400000, rate: 4.99, fixedTerm: 'None', type: 'pi', isIO: false, ioYears: 2, term: 30, freq: 52 }];
    let trancheCounter = 1, isInitialLoad = true, urlUpdateTimeout; 
    
    let hasExplicitTarget = false;
    let explicitTargetValue = 0;
    let userActionSource = 'calc'; 

    let loanChart; 
    let memoryPrice = 500000;
    let memoryDeposit = 100000;
    let expectedLoanTotal = 400000;

    document.addEventListener('blur', function(e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
            updateURLParams(true);
        }
    }, true);

    function cleanNum(val) {
        if (typeof val === 'number') return isNaN(val) ? 0 : Math.max(0, val);
        if (!val) return 0;
        const parsed = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
        return isNaN(parsed) ? 0 : Math.max(0, parsed);
    }
    
    function getRawValue(id) {
        const el = document.getElementById(id);
        if(!el) return 0;
        return cleanNum(el.value);
    }
    
    function formatMoney(num) { return "$" + Math.round(num).toLocaleString(); }
    
    function attachCurrencyListeners() {
        document.querySelectorAll('.has-currency:not([data-currency-attached="true"])').forEach(input => {
            const newClone = input.cloneNode(true);
            newClone.removeAttribute('oninput');
            newClone.removeAttribute('onchange');
            newClone.setAttribute('data-currency-attached', 'true');
            input.parentNode.replaceChild(newClone, input);
            
            newClone.addEventListener('input', function(e) {
                let cursorPosition = this.selectionStart;
                let originalValue = this.value;
                let cleanValue = originalValue.replace(/[^0-9]/g, '');
                
                if (cleanValue === '') {
                    if (this.value !== '') this.value = '';
                } else {
                    let formattedValue = parseInt(cleanValue, 10).toLocaleString('en-US');
                    
                    if (this.value !== formattedValue) {
                        let digitsBeforeCursor = originalValue.substring(0, cursorPosition).replace(/[^0-9]/g, '').length;
                        
                        this.value = formattedValue;
                        
                        let newCursorPos = 0;
                        let digitsSeen = 0;
                        while (newCursorPos < formattedValue.length && digitsSeen < digitsBeforeCursor) {
                            if (formattedValue[newCursorPos] >= '0' && formattedValue[newCursorPos] <= '9') {
                                digitsSeen++;
                            }
                            newCursorPos++;
                        }
                        
                        this.setSelectionRange(newCursorPos, newCursorPos);
                        setTimeout(() => {
                            if (document.activeElement === this) {
                                this.setSelectionRange(newCursorPos, newCursorPos);
                            }
                        }, 0);
                    }
                }

                if(this.classList.contains('tranche-amt')) handleTrancheAmountEdit(this.dataset.id, this.value);
                else if(this.id === 'extraInput') syncFromInput('input');
                else runFullCalculation();
            });

            newClone.addEventListener('blur', function() {
                if(this.value.trim() === '') {
                    this.value = '0';
                    if(this.classList.contains('tranche-amt')) handleTrancheAmountEdit(this.dataset.id, this.value);
                    else if(this.id === 'extraInput') syncFromInput('blur');
                    else runFullCalculation();
                } else {
                    if(this.id === 'extraInput') syncFromInput('blur');
                    else runFullCalculation();
                }
            });
        });
    }

    function renderTranches() {
        const container = document.getElementById('trancheList');
        container.innerHTML = '';

        tranches.forEach((t, index) => {
            const card = document.createElement('div');
            card.className = 'tranche-card';
            
            let rmHtml = tranches.length > 1 ? `<button type="button" class="remove-tranche" onclick="removeTranche(${t.id})">Remove X</button>` : `<div></div>`;
            
            let headerHtml = `
                <div class="tranche-card-header">
                    <span>Loan Split ${index + 1}</span>
                    ${rmHtml}
                </div>
            `;
            
            let amtHtml = `
                <div>
                    <span class="tranche-label">Amount</span>
                    <div class="currency-wrap">
                        <span class="currency-symbol">$</span>
                        <input type="text" inputmode="numeric" class="has-currency tranche-amt" data-id="${t.id}" value="${t.amount.toLocaleString()}">
                    </div>
                </div>
            `;

            let rateHtml = `
                <div>
                    <span class="tranche-label">Rate (%)</span>
                    <input type="number" step="0.01" value="${t.rate}" onchange="updateTrancheVal(${t.id}, 'rate', this.value)">
                </div>
            `;

            let fixedHtml = `
                <div>
                    <span class="tranche-label">Fixed Period</span>
                    <select onchange="updateTrancheVal(${t.id}, 'fixedTerm', this.value)" style="height: 38px;">
                        <option value="None" ${t.fixedTerm === 'None' ? 'selected' : ''}>None Selected</option>
                        <option value="Floating" ${t.fixedTerm === 'Floating' ? 'selected' : ''}>Floating</option>
                        <option value="6 Months" ${t.fixedTerm === '6 Months' ? 'selected' : ''}>6 Months</option>
                        <option value="1 Year" ${t.fixedTerm === '1 Year' ? 'selected' : ''}>1 Year</option>
                        <option value="18 Months" ${t.fixedTerm === '18 Months' ? 'selected' : ''}>18 Months</option>
                        <option value="2 Years" ${t.fixedTerm === '2 Years' ? 'selected' : ''}>2 Years</option>
                        <option value="3 Years" ${t.fixedTerm === '3 Years' ? 'selected' : ''}>3 Years</option>
                        <option value="4 Years" ${t.fixedTerm === '4 Years' ? 'selected' : ''}>4 Years</option>
                        <option value="5 Years" ${t.fixedTerm === '5 Years' ? 'selected' : ''}>5 Years</option>
                    </select>
                </div>
            `;

            let y = Math.floor(t.term);
            let m = Math.round((t.term - y) * 12);

            let termHtml = `
                <div>
                    <span class="tranche-label">Term (Y / M)</span>
                    <div style="display:flex; gap:4px;">
                        <input type="number" value="${y}" onchange="updateTrancheVal(${t.id}, 'termY', this.value)" style="padding:0 2px; text-align:center; min-width:0;" title="Years">
                        <input type="number" value="${m}" onchange="updateTrancheVal(${t.id}, 'termM', this.value)" style="padding:0 2px; text-align:center; min-width:0;" title="Months">
                    </div>
                </div>
            `;

            let typeHtml = `
                <div>
                    <span class="tranche-label">Type</span>
                    <select onchange="updateTrancheVal(${t.id}, 'type', this.value)" style="margin-bottom:4px; height: 38px;">
                        <option value="pi" ${t.type === 'pi' ? 'selected' : ''}>P&I</option>
                        <option value="io" ${t.type === 'io' ? 'selected' : ''}>Interest Only</option>
                        <option value="rev" ${t.type === 'rev' ? 'selected' : ''}>Revolving Credit</option>
                        <option value="revred" ${t.type === 'revred' ? 'selected' : ''}>Rev. Credit (Reducing)</option>
                        <option value="offset" ${t.type === 'offset' ? 'selected' : ''}>Offset</option>
                    </select>
                    <select style="display: ${t.type === 'io' ? 'block' : 'none'}; font-size:11px; height:26px;" onchange="updateTrancheVal(${t.id}, 'ioYears', this.value)">
                        <option value="1" ${t.ioYears == 1 ? 'selected' : ''}>1 Yr IO</option>
                        <option value="2" ${t.ioYears == 2 ? 'selected' : ''}>2 Yrs IO</option>
                        <option value="3" ${t.ioYears == 3 ? 'selected' : ''}>3 Yrs IO</option>
                        <option value="4" ${t.ioYears == 4 ? 'selected' : ''}>4 Yrs IO</option>
                        <option value="5" ${t.ioYears == 5 ? 'selected' : ''}>5 Yrs IO</option>
                    </select>
                </div>
            `;

            let freqHtml = `
                <div>
                    <span class="tranche-label">Freq</span>
                    <select onchange="updateTrancheVal(${t.id}, 'freq', this.value)" style="height: 38px;">
                        <option value="52" ${t.freq == 52 ? 'selected' : ''}>Weekly</option>
                        <option value="26" ${t.freq == 26 ? 'selected' : ''}>Fortnightly</option>
                        <option value="12" ${t.freq == 12 ? 'selected' : ''}>Monthly</option>
                    </select>
                </div>
            `;

            let rowInner = `<div class="tranche-row">${amtHtml}${rateHtml}${fixedHtml}${termHtml}${typeHtml}${freqHtml}</div>`;
            card.innerHTML = headerHtml + rowInner;
            container.appendChild(card);
        });

        attachCurrencyListeners();
        updateAdvancedTotal();
        
        const hasOffsetRev = tranches.some(t => ['offset', 'rev', 'revred'].includes(t.type));
        const offsetBox = document.getElementById('offsetFeatureBox');
        if (offsetBox) {
            offsetBox.style.display = hasOffsetRev ? 'flex' : 'none';
            if (!hasOffsetRev) {
                document.getElementById('globalOffsetBal').value = '0';
            }
        }
    }

    function addTranche() {
        if(tranches.length >= 10) return; 
        trancheCounter++;
        
        let y = getRawValue('years') || 0;
        let m = getRawValue('months') || 0;
        let globalTerm = y + (m / 12);
        if (globalTerm <= 0) globalTerm = 30;

        tranches.push({ id: trancheCounter, amount: 0, rate: 4.99, fixedTerm: 'None', type: 'pi', isIO: false, ioYears: 2, term: globalTerm, freq: freq });
        renderTranches();
        runFullCalculation();
    }

    function removeTranche(id) {
        tranches = tranches.filter(t => t.id !== id);
        renderTranches();
        runFullCalculation();
    }

    function updateTrancheVal(id, key, val) {
        const t = tranches.find(t => t.id == id);
        if(key === 'type') {
            t.type = val;
            t.isIO = (val === 'io' || val === 'rev');
        }
        else if(key === 'ioYears') t.ioYears = cleanNum(val);
        else if(key === 'termY') { 
            let curM = Math.round((t.term - Math.floor(t.term)) * 12); 
            t.term = cleanNum(val) + (curM / 12); 
            if(t.term <= 0) t.term = 30;
        }
        else if(key === 'termM') { 
            let curY = Math.floor(t.term); 
            t.term = curY + (cleanNum(val) / 12); 
            if(t.term <= 0) t.term = 30;
        }
        else if(key === 'freq') t.freq = cleanNum(val) || 52;
        else if(key === 'fixedTerm') t.fixedTerm = val;
        else if(key === 'rate') t.rate = cleanNum(val);
        
        if(key === 'type') renderTranches(); 
        runFullCalculation();
    }

    function handleTrancheAmountEdit(id, valStr) {
        const val = cleanNum(valStr);
        const t = tranches.find(t => t.id == id);
        if(t) t.amount = val;
        updateAdvancedTotal();
        runFullCalculation();
    }

    function updateAdvancedTotal() {
        const sum = tranches.reduce((acc, t) => acc + t.amount, 0);
        const display = document.getElementById('advTotalDisplay');
        if(display) display.innerText = formatMoney(sum);
    }

    function copyChartToClipboard() {
        const btn = document.getElementById('copyChartBtn');
        const price = getRawValue('priceOrLoan');
        const totalLoan = calcMode === 'buy' ? Math.max(0, price - getRawValue('deposit')) : price;
        const globalExtra = parseFloat(document.getElementById('extraSlider').value) || 0;
        
        let sRate = cleanNum(document.getElementById('simpleRate').value);
        let sFixed = document.getElementById('simpleFixedTerm').value || 'None';
        
        let validT = complexity === 'simple' 
            ? [{ id:1, amount: totalLoan, rate: sRate, fixedTerm: sFixed, type: 'pi', isIO: false, ioYears: 0, term: (getRawValue('years') || 0) + ((getRawValue('months') || 0) / 12) || 30, freq: freq }] 
            : tranches.filter(t => t.amount > 0);
        
        let pni = validT.filter(t => t.type !== 'io' && t.type !== 'rev');
        let targetId = pni.length > 0 ? pni.sort((a,b)=>b.rate - a.rate)[0].id : null;

        function getBasePI(pv, r, n) { if(n<=0) return pv; if(r===0) return pv/n; return (pv*r)/(1-Math.pow(1+r,-n)); }

        let linkParams = buildURLParams();
        linkParams.set('tc', 'false'); 
        linkParams.set('tcr', '0');
        linkParams.set('tci', '0');
        let playLink = window.location.origin + window.location.pathname + '?' + linkParams.toString();

        let rows = '';
        let plain = `Proposed Loan Structure - Click here to play with these numbers in our calculator 📊: ${playLink}\n\n`;
        plain += 'Loan Amount\tInterest Rate\tFixed Period\tMax Loan Term\tRepayment Type\tRepayment Frequency\tMinimum Repayment\tElected Repayment\n';
        
        let annMinTotal = 0, annElecTotal = 0, totalAmt = 0;

        let hasMixedFreq = false;
        let firstFreq = validT.length > 0 ? validT[0].freq : freq;
        validT.forEach(t => { if (t.freq !== firstFreq || t.freq !== freq) hasMixedFreq = true; });

        let dashboardFreqLabel = freq === 52 ? 'wk' : (freq === 26 ? 'fn' : 'mo');
        let fNameLower = freq === 52 ? 'weekly' : (freq === 26 ? 'fortnightly' : 'monthly');
        let fNameTitle = freq === 52 ? 'Weekly' : (freq === 26 ? 'Fortnightly' : 'Monthly');

        validT.forEach(t => {
            let r = (t.rate/100)/t.freq;
            let n = (t.term || 30) * t.freq;
            let min = 0;
            
            if(t.type === 'io' || t.type === 'rev') {
                min = t.amount * r;
            } else if (t.type === 'revred') {
                let limitDrop = t.amount / n;
                if (!isFinite(limitDrop) || isNaN(limitDrop)) limitDrop = 0;
                min = (t.amount * r) + limitDrop;
            } else {
                min = getBasePI(t.amount, r, n);
            }
            if (isNaN(min) || !isFinite(min)) min = 0;
            
            let mappedExtra = targetId === t.id ? (globalExtra * freq / t.freq) : 0;
            let elec = min + mappedExtra;
            
            totalAmt += t.amount;
            annMinTotal += min * t.freq;
            annElecTotal += elec * t.freq;
            
            let typeStr = '';
            if(t.type === 'io') typeStr = `Interest Only (${t.ioYears} Yrs)`;
            else if(t.type === 'rev') typeStr = 'Revolving Credit';
            else if(t.type === 'revred') typeStr = 'Revolving Credit (Reducing)';
            else if(t.type === 'offset') typeStr = 'Offset';
            else typeStr = 'P&I';

            let tFreqName = t.freq === 52 ? 'Weekly' : t.freq === 26 ? 'Fortnightly' : 'Monthly';
            let tFreqLabel = t.freq === 52 ? 'wk' : t.freq === 26 ? 'fn' : 'mo';
            let tFixed = (t.fixedTerm === 'None' || !t.fixedTerm) ? '-' : t.fixedTerm;
            
            let yLabel = Math.floor(t.term);
            let mLabel = Math.round((t.term - yLabel) * 12);
            let termLabelStr = mLabel > 0 ? `${yLabel} Yr, ${mLabel} Mo` : `${yLabel} Yrs`;

            let minText = `${formatMoney(min)} / ${tFreqLabel}`;
            let elecText = `${formatMoney(elec)} / ${tFreqLabel}`;

            rows += `<tr style="border-bottom: 1px solid #eee;">
                <td style="padding:12px; border:1px solid #e1e1e1; text-align:center; color:#1a1a1a;">${formatMoney(t.amount)}</td>
                <td style="padding:12px; border:1px solid #e1e1e1; text-align:center; color:#1a1a1a;">${t.rate.toFixed(2)}%</td>
                <td style="padding:12px; border:1px solid #e1e1e1; text-align:center; color:#1a1a1a;">${tFixed}</td>
                <td style="padding:12px; border:1px solid #e1e1e1; text-align:center; color:#1a1a1a;">${termLabelStr}</td>
                <td style="padding:12px; border:1px solid #e1e1e1; text-align:center; color:#1a1a1a;">${typeStr}</td>
                <td style="padding:12px; border:1px solid #e1e1e1; text-align:center; color:#1a1a1a;">${tFreqName}</td>
                <td style="padding:12px; border:1px solid #e1e1e1; text-align:center; color:#1a1a1a;">${minText}</td>
                <td style="padding:12px; border:1px solid #e1e1e1; text-align:center; color:#61A0FF; font-weight:800;">${elecText}</td>
            </tr>`;
            plain += `${formatMoney(t.amount)}\t${t.rate.toFixed(2)}%\t${tFixed}\t${termLabelStr}\t${typeStr}\t${tFreqName}\t${minText}\t${elecText}\n`;
        });

        let finalMin = annMinTotal / freq;
        let finalElec = annElecTotal / freq;
        
        let finalMinText = `${formatMoney(finalMin)} / ${dashboardFreqLabel}`;
        let finalElecText = `${formatMoney(finalElec)} / ${dashboardFreqLabel}`;
        
        let totalRowLabel = hasMixedFreq ? `Combined Total (${fNameTitle} equivalent)*` : `Totals`;
        
        let disclaimers = [];
        if (hasMixedFreq) {
            disclaimers.push(`<strong>Combined Totals:</strong> Because your loan splits use different payment frequencies, the values are converted into a combined ${fNameLower} equivalent for the total row.`);
        }
        if (validT.some(t => t.type === 'offset')) {
            disclaimers.push(`<strong>Offset Accounts:</strong> Your minimum regular repayment stays exactly the same regardless of your offset funds. However, the offset funds reduce the interest charged, meaning a higher portion of your repayment goes directly toward paying down the principal, shortening your loan term.`);
        }
        if (validT.some(t => t.type === 'rev' || t.type === 'revred')) {
            disclaimers.push(`<strong>Revolving Credit:</strong> Minimum repayments shown in this table assume the facility is fully drawn at the stated interest rate. Your actual minimum required repayment will vary based on your drawn balance.`);
        }
        disclaimers.push(`<strong>Indicative Only:</strong> Please note that these payments are indicative only. Your lender will confirm the actual final repayment amounts in the loan documentation.`);

        let disclaimerHtml = `<ul style="font-family: sans-serif; font-size: 11px; color: #666666; text-align: left; max-width: 850px; margin: 0; padding-left: 20px; line-height: 1.6;">`;
        disclaimers.forEach(d => {
            disclaimerHtml += `<li style="margin-bottom: 8px;">${d}</li>`;
        });
        disclaimerHtml += `</ul>`;

        let thStyle = `background-color:#1F2023; padding:12px; text-align:center; color:#ffffff;`;
        
        let html = `
            <div style="font-family: sans-serif; color:#1a1a1a; text-align:left;">
                <div style="text-align:left; display:inline-block; width:100%; max-width:900px;">
                    <h3 style="color:#1a1a1a; margin:0; font-family: sans-serif; font-size:16px;">
                        <b>Proposed Loan Structure - <a href="${playLink}" style="color: #61A0FF; text-decoration: none;">Click here to play with these numbers in our calculator 📊</a></b>
                    </h3>
                    <br><br>
                    <table width="100%" style="font-family: sans-serif; width:auto; max-width:900px; margin:0; border-collapse:collapse; font-size:13px; text-align:center; border: 1px solid #e1e1e1;">
                        <thead style="background-color:#1F2023;"><tr>
                            <th bgcolor="#1F2023" style="${thStyle}"><b>Loan Amount</b></th>
                            <th bgcolor="#1F2023" style="${thStyle}"><b>Interest Rate</b></th>
                            <th bgcolor="#1F2023" style="${thStyle}"><b>Fixed Period</b></th>
                            <th bgcolor="#1F2023" style="${thStyle}"><b>Max Loan Term</b></th>
                            <th bgcolor="#1F2023" style="${thStyle}"><b>Repayment Type</b></th>
                            <th bgcolor="#1F2023" style="${thStyle}"><b>Frequency</b></th>
                            <th bgcolor="#1F2023" style="${thStyle}"><b>Minimum Repayment</b></th>
                            <th bgcolor="#1F2023" style="${thStyle}"><b>Elected Repayment</b></th>
                        </tr></thead>
                        <tbody>${rows}
                        <tr style="background-color:#e6e6e6;">
                            <td style="padding:12px; border:1px solid #d1d1d1; text-align:center; font-size:14px; color:#1a1a1a;"><b>${formatMoney(totalAmt)}</b></td>
                            <td style="padding:12px; border:1px solid #d1d1d1; text-align:center; font-size:12px; color:#1a1a1a;" colspan="5"><b>${totalRowLabel}</b></td>
                            <td style="padding:12px; border:1px solid #d1d1d1; text-align:center; font-size:14px; color:#1a1a1a;"><b>${finalMinText}</b></td>
                            <td style="padding:12px; border:1px solid #d1d1d1; text-align:center; color:#61A0FF; font-size:14px;"><b>${finalElecText}</b></td>
                        </tr></tbody>
                    </table>
                    <br><br>
                    ${disclaimerHtml}
                </div>
            </div>`;
            
        plain += `\nTOTALS: \t\t\t\t\t\t${finalMinText}\t${finalElecText}\n\n\n`;
        disclaimers.forEach(d => {
            let cleanD = d.replace(/<strong>/g, '').replace(/<\/strong>/g, '');
            plain += `* ${cleanD}\n\n`;
        });

        function showChartCopied() {
            let orig = btn.innerText;
            btn.innerText = "✓ Chart Copied!"; 
            btn.style.backgroundColor = "var(--hlf-cyan)"; 
            btn.style.color = "var(--hlf-black)";
            setTimeout(() => { 
                btn.innerText = orig; 
                btn.style.backgroundColor = "transparent"; 
                btn.style.color = "var(--hlf-black)"; 
            }, 2000);
        }

        if (navigator.clipboard && window.isSecureContext && typeof ClipboardItem !== 'undefined') {
            navigator.clipboard.write([new ClipboardItem({ 
                'text/html': new Blob([html], {type: 'text/html'}), 
                'text/plain': new Blob([plain], {type: 'text/plain'}) 
            })]).then(showChartCopied).catch(fallbackChartCopy);
        } else {
            fallbackChartCopy();
        }

        function fallbackChartCopy() {
            const div = document.createElement("div");
            div.contentEditable = true; div.innerHTML = html; div.style.position = "fixed"; div.style.left = "-999999px";
            document.body.appendChild(div);
            const range = document.createRange(); range.selectNodeContents(div);
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
            try { document.execCommand('copy'); showChartCopied(); } 
            catch (err) { console.error('Fallback copy failed', err); }
            div.remove();
        }
    }

    function buildURLParams() {
        const paramObj = new URLSearchParams();
        paramObj.set('mode', calcMode); paramObj.set('c', complexity === 'advanced' ? 'adv' : 'sim');
        if(calcMode === 'buy') {
            paramObj.set('p', getRawValue('priceOrLoan')); paramObj.set('d', getRawValue('deposit'));
        } else {
            paramObj.set('p', memoryPrice); paramObj.set('d', memoryDeposit);
        }
        paramObj.set('y', getRawValue('years')); paramObj.set('m', getRawValue('months'));
        paramObj.set('f', freq); paramObj.set('ex', document.getElementById('extraSlider').value);
        if (complexity === 'simple') {
            paramObj.set('r', cleanNum(document.getElementById('simpleRate').value));
            paramObj.set('sft', document.getElementById('simpleFixedTerm').value);
        } else {
            const validUrlTranches = tranches.filter(t => t.amount > 0);
            const trToMap = validUrlTranches.length > 0 ? validUrlTranches : tranches.slice(0, 1);
            const trStr = trToMap.map(t => `${t.amount}~${t.rate}~${t.type}~${t.ioYears}~${t.term}~${t.freq}~${t.fixedTerm}`).join('_');
            paramObj.set('tr', trStr); paramObj.set('ob', getRawValue('globalOffsetBal'));
        }
        paramObj.set('tc', isTrueCost);
        if(isTrueCost) { paramObj.set('tcr', getRawValue('ratesInput')); paramObj.set('tci', getRawValue('insInput')); }
        return paramObj;
    }

    function loadParamsFromURL() {
        const params = new URLSearchParams(window.location.search);
        if(params.has('p')) { document.getElementById('priceOrLoan').value = cleanNum(params.get('p')).toLocaleString(); memoryPrice = cleanNum(params.get('p')); }
        if(params.has('d')) { document.getElementById('deposit').value = cleanNum(params.get('d')).toLocaleString(); memoryDeposit = cleanNum(params.get('d')); }
        if(params.has('mode')) {
            const mode = params.get('mode'); const btn = document.querySelector(`#modeButtons button[data-mode="${mode}"]`);
            if(btn) setMode(mode, btn);
        }
        if(params.has('y')) document.getElementById('years').value = cleanNum(params.get('y'));
        if(params.has('m')) document.getElementById('months').value = cleanNum(params.get('m'));
        if(params.has('f')) {
            const f = parseInt(params.get('f'));
            const btn = document.querySelector(`.freq-btn[data-val="${f}"]`);
            if(btn) {
                freq = f; freqName = btn.innerText;
                document.querySelectorAll('.freq-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll(`.freq-btn[data-val="${f}"]`).forEach(matchBtn => matchBtn.classList.add('active'));
                let labelName = f === 52 ? "week" : f === 26 ? "fortnight" : "month";
                document.getElementById('freqDisplayLabel').innerText = freqName + " Repayment";
                document.getElementById('stickyLabel').innerText = freqName + " Repayment";
                document.getElementById('extraClarification').innerText = "Target repayment / " + labelName;
                document.getElementById('tcLabel').innerText = "/ " + labelName;
            }
        }
        if(params.has('c')) {
            if(params.get('c') === 'adv') { 
                complexity = 'advanced'; document.getElementById('hlf-wrapper').classList.add('is-advanced');
                const btnAdv = document.querySelectorAll('#complexityButtons button')[1];
                document.querySelectorAll('#complexityButtons button').forEach(b => b.classList.remove('active'));
                btnAdv.classList.add('active');
                if(params.has('tr')) {
                    const trData = params.get('tr').split('_');
                    tranches = trData.map((str, idx) => {
                        const parts = str.split('~'); let typeRaw = parts[2]; let tType = (typeRaw === '1') ? 'io' : (typeRaw === '0' ? 'pi' : typeRaw);
                        return {
                            id: idx + 1, amount: cleanNum(parts[0]), rate: cleanNum(parts[1]), type: tType,
                            isIO: (tType === 'io' || tType === 'rev'), ioYears: cleanNum(parts[3]), term: cleanNum(parts[4]) || 30,
                            freq: cleanNum(parts[5]) || 52, fixedTerm: parts[6] || 'None'
                        };
                    });
                    trancheCounter = tranches.length;
                }
                if(params.has('ob')) document.getElementById('globalOffsetBal').value = cleanNum(params.get('ob')).toLocaleString();
            } else {
                complexity = 'simple'; let rVal = cleanNum(params.get('r'));
                if(rVal) document.getElementById('simpleRate').value = rVal;
                let sft = params.get('sft'); if(sft) document.getElementById('simpleFixedTerm').value = sft;
            }
        } else {
            let rVal = cleanNum(params.get('r')); if(rVal) document.getElementById('simpleRate').value = rVal;
            let sft = params.get('sft'); if(sft) document.getElementById('simpleFixedTerm').value = sft;
        }
        if(params.has('tc')) {
            const tcVal = params.get('tc') === 'true';
            if(params.has('tcr')) document.getElementById('ratesInput').value = cleanNum(params.get('tcr')).toLocaleString();
            else document.getElementById('ratesInput').value = Math.round(3640 / freq).toLocaleString(); 
            if(params.has('tci')) document.getElementById('insInput').value = cleanNum(params.get('tci')).toLocaleString();
            else document.getElementById('insInput').value = Math.round(2600 / freq).toLocaleString(); 
            const btnTC = document.querySelectorAll('#tcButtons button')[tcVal ? 1 : 0];
            setTC(tcVal, btnTC);
        } else {
            document.getElementById('ratesInput').value = Math.round(3640 / freq).toLocaleString(); 
            document.getElementById('insInput').value = Math.round(2600 / freq).toLocaleString(); 
        }
        if(params.has('ex')) {
            const ex = cleanNum(params.get('ex'));
            if (ex > 0) userActionSource = 'slider';
            document.getElementById('extraSlider').value = ex;
        }
        isInitialLoad = false; renderTranches(); calculate();
    }

    function updateURLParams(force = false) {
        if(isInitialLoad) return; 
        clearTimeout(urlUpdateTimeout);
        if (force) {
            try { const newUrl = window.location.pathname + '?' + buildURLParams().toString(); window.history.replaceState({}, '', newUrl); } catch (e) { }
        } else {
            urlUpdateTimeout = setTimeout(() => {
                if (document.activeElement && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
                try { const newUrl = window.location.pathname + '?' + buildURLParams().toString(); window.history.replaceState({}, '', newUrl); } catch (e) { }
            }, 1000); 
        }
    }

    function copyShareLink() {
        const btn = document.getElementById('shareBtn');
        const generatedUrl = window.location.origin + window.location.pathname + '?' + buildURLParams().toString();
        function showLinkCopied() {
            let orig = btn.innerText; btn.innerText = "✓ Copied!";
            btn.style.backgroundColor = "var(--hlf-cyan)"; btn.style.color = "var(--hlf-black)"; btn.style.borderColor = "var(--hlf-cyan)";
            setTimeout(() => { btn.innerText = orig; btn.style.backgroundColor = "transparent"; btn.style.color = "var(--hlf-black)"; btn.style.borderColor = "var(--hlf-black)"; }, 2000);
        }
        if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(generatedUrl).then(showLinkCopied).catch(fallbackLinkCopy);
        } else { fallbackLinkCopy(); }
        function fallbackLinkCopy() {
            let textArea = document.createElement("textarea"); textArea.value = generatedUrl; textArea.style.position = "fixed"; textArea.style.left = "-999999px";
            document.body.appendChild(textArea); textArea.focus(); textArea.select();
            try { document.execCommand('copy'); showLinkCopied(); } catch (err) { console.error('Fallback copy failed', err); }
            textArea.remove();
        }
    }

    window.addEventListener('scroll', () => {
        const dashboard = document.getElementById('mainDashboard'); const sticky = document.getElementById('mobileSticky');
        if(!dashboard || !sticky) return;
        if(window.innerWidth <= 800) {
            const rect = dashboard.getBoundingClientRect();
            if (rect.bottom < window.innerHeight * 0.5) sticky.classList.add('visible');
            else sticky.classList.remove('visible');
        } else { sticky.classList.remove('visible'); }
    });

    function setComplexity(level, btn) {
        complexity = level; document.querySelectorAll('#complexityButtons button').forEach(b => b.classList.remove('active')); if(btn) btn.classList.add('active');
        const wrap = document.getElementById('hlf-wrapper');
        if(level === 'advanced') {
            wrap.classList.add('is-advanced');
            if (calcMode !== 'own') { const ownBtn = document.querySelectorAll('#modeButtons button')[1]; setMode('own', ownBtn); }
            if(tranches.length === 1 && tranches[0].amount === 0) {
                tranches[0].amount = expectedLoanTotal;
                tranches[0].rate = cleanNum(document.getElementById('simpleRate').value);
                tranches[0].term = (getRawValue('years') || 0) + ((getRawValue('months') || 0) / 12) || 30;
                tranches[0].freq = freq;
                tranches[0].fixedTerm = document.getElementById('simpleFixedTerm').value;
                renderTranches();
            }
        } else {
            wrap.classList.remove('is-advanced');
            if(tranches.length > 0) { document.getElementById('simpleRate').value = tranches[0].rate; document.getElementById('simpleFixedTerm').value = tranches[0].fixedTerm || 'None'; }
        }
        runFullCalculation();
    }

    function setDepositPct(pct) {
        if(calcMode !== 'buy') return;
        const price = getRawValue('priceOrLoan'); document.getElementById('deposit').value = Math.round(price * (pct / 100)).toLocaleString();
        runFullCalculation();
    }

    function setMode(mode, btn) {
        calcMode = mode; document.querySelectorAll('#modeButtons button').forEach(b => b.classList.remove('active')); if(btn) btn.classList.add('active');
        const primaryLabel = document.getElementById('primaryLabel'); const primaryTooltipText = document.getElementById('primaryTooltipText');
        const depositBox = document.getElementById('depositBox'); const priceInput = document.getElementById('priceOrLoan');
        if(mode === 'buy') {
            primaryLabel.innerText = "Purchase Price"; primaryTooltipText.innerText = "The total amount you plan to spend on buying the property.";
            depositBox.classList.remove('hidden'); priceInput.value = memoryPrice.toLocaleString(); document.getElementById('deposit').value = memoryDeposit.toLocaleString();
        } else {
            primaryLabel.innerText = "Total Loan Balance"; primaryTooltipText.innerText = "The total amount currently remaining on your mortgage.";
            depositBox.classList.add('hidden'); let loanEquiv = Math.max(0, memoryPrice - memoryDeposit); priceInput.value = loanEquiv > 0 ? loanEquiv.toLocaleString() : "0";
        }
        runFullCalculation();
    }

    function setTC(val, btn) {
        isTrueCost = val;
        if(btn) { document.querySelectorAll('#tcButtons button').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
        const wrapper = document.getElementById('tcWrapper');
        if(val) wrapper.classList.add('active'); else wrapper.classList.remove('active');
        if(!isInitialLoad) runFullCalculation();
    }

    function syncTCInput() { runFullCalculation(); }

    function setFreq(newFreq, btn) {
        let oldFreq = freq; if(newFreq === oldFreq) return;
        freq = newFreq; freqName = btn.innerText;
        document.querySelectorAll('.freq-btn').forEach(b => { b.classList.remove('active'); if(parseInt(b.dataset.val) === newFreq) b.classList.add('active'); });
        
        if (hasExplicitTarget) {
            let annualTarget = explicitTargetValue * oldFreq;
            explicitTargetValue = annualTarget / newFreq;
        }

        let annualRates = getRawValue('ratesInput') * oldFreq; let annualIns = getRawValue('insInput') * oldFreq;
        document.getElementById('ratesInput').value = Math.round(annualRates / newFreq).toLocaleString(); document.getElementById('insInput').value = Math.round(annualIns / newFreq).toLocaleString();
        let labelName = newFreq === 52 ? "week" : newFreq === 26 ? "fortnight" : "month";
        document.getElementById('extraClarification').innerText = "Target repayment / " + labelName; document.getElementById('tcLabel').innerText = "/ " + labelName;
        runFullCalculation();
    }

    function syncFromSlider() {
        userActionSource = 'slider';
        runFullCalculation();
    }

    function syncFromInput(eventType) {
        userActionSource = eventType || 'input';
        runFullCalculation();
    }

    function runFullCalculation() {
        if(isInitialLoad) return;
        try {
            const val1 = getRawValue('priceOrLoan'); const deposit = getRawValue('deposit');
            if (calcMode === 'buy') {
                memoryPrice = val1; memoryDeposit = deposit; expectedLoanTotal = Math.max(0, val1 - deposit);
                const depInd = document.getElementById('depositPercentIndicator');
                if (val1 > 0) { const depPct = (deposit / val1) * 100; depInd.innerText = `${Math.round(depPct)}% Deposit`; depInd.style.color = "var(--hlf-black)"; 
                } else { depInd.innerText = "0% Deposit"; }
            } else { expectedLoanTotal = val1; memoryPrice = expectedLoanTotal + memoryDeposit; }

            let calcTranches = [];
            const stdView = document.getElementById('stdView'); const ioView = document.getElementById('ioView');

            if(complexity === 'simple') {
                let globalYears = getRawValue('years') || 0;
                let globalMonths = getRawValue('months') || 0;
                let globalTotalTerm = globalYears + (globalMonths / 12);
                if (globalTotalTerm <= 0) globalTotalTerm = 30;

                calcTranches = [{ id: 1, amount: expectedLoanTotal, rate: cleanNum(document.getElementById('simpleRate').value), type: 'pi', isIO: false, ioYears: 0, term: globalTotalTerm, freq: freq }];
                stdView.classList.add('active'); ioView.classList.remove('active');
            } else {
                calcTranches = JSON.parse(JSON.stringify(tranches)); 
                let validTranches = calcTranches.filter(t => t.amount > 0);
                const hasIO = validTranches.some(t => t.type === 'io');
                if(hasIO) { stdView.classList.remove('active'); ioView.classList.add('active'); } 
                else { stdView.classList.add('active'); ioView.classList.remove('active'); }
                expectedLoanTotal = calcTranches.reduce((sum, tr) => sum + cleanNum(tr.amount), 0);
            }

            const repDisplay = document.getElementById('repaymentDisplay'); const stickyVal = document.getElementById('stickyValue');
            let validCalcTranches = calcTranches.filter(t => t.amount > 0);
            if (expectedLoanTotal <= 0 || validCalcTranches.length === 0) {
                repDisplay.innerText = "$0"; stickyVal.innerText = "$0"; document.getElementById('smartNotice').classList.remove('visible');
                if (loanChart) { loanChart.destroy(); loanChart = null; }
                return;
            }

            const trueCost = (complexity === 'advanced' && isTrueCost) ? (getRawValue('ratesInput') + getRawValue('insInput')) : 0;
            const displayLabel = document.getElementById('freqDisplayLabel'); const stickyLabel = document.getElementById('stickyLabel');
            if (complexity === 'simple') { displayLabel.innerText = `${freqName} Repayment`; stickyLabel.innerText = `${freqName} Repayment`;
            } else { displayLabel.innerText = isTrueCost ? `Combined ${freqName} Total` : `Combined ${freqName} Repayment`; stickyLabel.innerText = isTrueCost ? `Combined ${freqName} Total` : `Combined ${freqName} Repayment`; }

            const bdStd = document.getElementById('tcBreakdown'); const bdIO = document.getElementById('tcBreakdownIO'); const bdPhase2 = document.getElementById('tcBreakdownPhase2');
            if(complexity === 'advanced' && isTrueCost) {
                let tcText = `Includes $${trueCost.toLocaleString()} for Rates & Ins.`;
                bdStd.innerText = tcText; bdIO.innerText = tcText; bdPhase2.innerText = tcText;
                bdStd.classList.add('active'); bdIO.classList.add('active'); bdPhase2.classList.add('active');
            } else { bdStd.classList.remove('active'); bdIO.classList.remove('active'); bdPhase2.classList.remove('active'); }

            let maxTerm = Math.max(...validCalcTranches.map(t => parseFloat(t.term) || 30)) || 30;
            let totalGlobalPeriods = maxTerm * freq;

            function calcPI(pv, r, n) { if(n <= 0) return pv; if(r === 0) return pv / n; return (pv * r) / (1 - Math.pow(1 + r, -n)); }

            let tStd = validCalcTranches.map(t => {
                let tFreq = parseInt(t.freq) || freq; let tTerm = parseFloat(t.term) || 30; let tTrueRate = (parseFloat(t.rate) / 100) / tFreq; if(isNaN(tTrueRate)) tTrueRate = 0;
                let tTruePeriods = tTerm * tFreq; let tIoYears = parseInt(t.ioYears) || 0; let tIoPeriods = (t.type === 'io') ? tIoYears * tFreq : (t.type === 'rev' ? tTruePeriods : 0);
                let tPiPeriods = tTruePeriods - ((t.type === 'io') ? tIoYears * tFreq : 0); if(tPiPeriods < 0) tPiPeriods = 0;
                let minIoPmt = t.amount * tTrueRate; let minPiPmt = (t.type === 'rev') ? minIoPmt : calcPI(t.amount, tTrueRate, tPiPeriods);
                let annIo = minIoPmt * tFreq; let annPi = minPiPmt * tFreq;
                return { id: t.id, amount: t.amount, bal: t.amount, tFreq: tFreq, tTerm: tTerm, trueRate: tTrueRate, type: t.type, isIO: (t.type === 'io' || t.type === 'rev'), ioYears: tIoYears, annIo: annIo, annPi: annPi, passedGlobalPeriods: 0 };
            });

            let initialPhase1PaymentAnn = 0; let phase2FuturePaymentAnn = 0; let longestIOPeriod = 0;
            
            let initOffsetStd = getRawValue('globalOffsetBal');
            let eligibleInitStd = tStd.map(t => ({...t, appliedBuf: 0})).filter(t => ['rev', 'revred'].includes(t.type) && t.bal > 0).sort((a,b) => b.trueRate - a.trueRate);
            for (let et of eligibleInitStd) {
                if (initOffsetStd <= 0) break;
                let allocate = Math.min(initOffsetStd, et.bal);
                et.appliedBuf = allocate;
                initOffsetStd -= allocate;
            }

            tStd.forEach(t => {
                let eInit = eligibleInitStd.find(e => e.id === t.id); 
                let effBal = t.bal - (eInit ? eInit.appliedBuf : 0);
                
                let isRealIO = t.type === 'io' && t.ioYears > 0; 
                let stepInt = effBal * ((t.trueRate * t.tFreq) / freq); 
                if (isNaN(stepInt)) stepInt = 0;
                
                let reqAnn = 0;
                if (t.type === 'rev') { 
                    reqAnn = stepInt * freq; 
                } else if (t.type === 'revred') {
                    let limitDrop = t.amount / (t.tTerm * freq); 
                    if (!isFinite(limitDrop) || isNaN(limitDrop)) limitDrop = 0;
                    let currentLimit = t.amount - limitDrop; 
                    let forcedPrin = Math.max(0, effBal - currentLimit);
                    reqAnn = (stepInt + forcedPrin) * freq;
                } else if (t.type === 'io') { 
                    reqAnn = t.annIo; 
                } else { 
                    reqAnn = t.annPi; 
                }
                
                initialPhase1PaymentAnn += reqAnn;
                if (isRealIO && t.ioYears > longestIOPeriod) longestIOPeriod = t.ioYears;
                
                if (t.type === 'io') phase2FuturePaymentAnn += t.annPi; else phase2FuturePaymentAnn += reqAnn;
            });

            let initialPhase1Payment = initialPhase1PaymentAnn / freq;
            let finalMinPayment = initialPhase1Payment + trueCost;

            let sliderEl = document.getElementById('extraSlider');
            let inputEl = document.getElementById('extraInput');
            let globalExtraPerPeriod = 0;
            let targetPayment = finalMinPayment;

            if (userActionSource === 'input' || userActionSource === 'blur') {
                let rawTarget = getRawValue('extraInput');
                if (userActionSource === 'blur') {
                    if (rawTarget <= finalMinPayment) {
                        hasExplicitTarget = false;
                        explicitTargetValue = 0;
                        targetPayment = finalMinPayment;
                        inputEl.value = Math.round(targetPayment).toLocaleString();
                    } else {
                        hasExplicitTarget = true;
                        explicitTargetValue = rawTarget;
                        targetPayment = rawTarget;
                        inputEl.value = Math.round(targetPayment).toLocaleString();
                    }
                    sliderEl.value = Math.round(targetPayment - finalMinPayment);
                } else {
                    if (rawTarget > finalMinPayment) {
                        hasExplicitTarget = true;
                        explicitTargetValue = rawTarget;
                        targetPayment = rawTarget;
                        sliderEl.value = Math.round(rawTarget - finalMinPayment);
                    } else {
                        targetPayment = finalMinPayment;
                        sliderEl.value = 0;
                    }
                }
            } else if (userActionSource === 'slider') {
                let extra = parseFloat(sliderEl.value) || 0;
                if (extra > 0) {
                    hasExplicitTarget = true;
                    explicitTargetValue = finalMinPayment + extra;
                    targetPayment = explicitTargetValue;
                } else {
                    hasExplicitTarget = false;
                    explicitTargetValue = 0;
                    targetPayment = finalMinPayment;
                }
                inputEl.value = Math.round(targetPayment).toLocaleString();
            } else {
                if (hasExplicitTarget) {
                    if (finalMinPayment >= explicitTargetValue) {
                        hasExplicitTarget = false;
                        explicitTargetValue = 0;
                        targetPayment = finalMinPayment;
                    } else {
                        targetPayment = explicitTargetValue;
                    }
                } else {
                    targetPayment = finalMinPayment;
                }
                
                sliderEl.value = Math.round(targetPayment - finalMinPayment);
                if (document.activeElement !== inputEl) {
                    inputEl.value = Math.round(targetPayment).toLocaleString();
                }
            }
            
            let baseMax = freq === 52 ? 400 : (freq === 26 ? 800 : 1733);
            sliderEl.max = Math.max(baseMax, Math.round(targetPayment - finalMinPayment));
            
            globalExtraPerPeriod = targetPayment - finalMinPayment;
            userActionSource = 'calc'; 

            let tAcc = JSON.parse(JSON.stringify(tStd)); 
            let chartLabels = [], chartStd = [], chartAcc = [];
            let totalInterestStd = 0, totalInterestAcc = 0;
            let stdFinishedGlobalPeriod = totalGlobalPeriods; let stdHasHitZero = false;
            let accFinishedGlobalPeriod = totalGlobalPeriods; let accHasHitZero = false;
            let globalOffsetBalForGraph = getRawValue('globalOffsetBal');

            for(let p = 1; p <= totalGlobalPeriods; p++) {
                
                let bufStd = globalOffsetBalForGraph; 
                let currentStdGraphVal = 0; 
                tStd.forEach(t => { t.netBal = t.bal; });
                let eligibleGraphStd = tStd.filter(t => ['rev', 'revred'].includes(t.type) && t.bal > 0).sort((a,b) => b.trueRate - a.trueRate);
                tStd.forEach(t => t.appliedBuf = 0);
                for (let rt of eligibleGraphStd) {
                    if (bufStd <= 0) break; 
                    let applied = Math.min(bufStd, rt.bal); 
                    rt.appliedBuf = applied;
                    bufStd -= applied;
                }
                tStd.forEach(t => { 
                    t.netBal = t.bal - t.appliedBuf; 
                    currentStdGraphVal += t.bal; 
                });

                let bufAcc = globalOffsetBalForGraph; 
                let currentAccGraphVal = 0; 
                tAcc.forEach(t => { t.netBal = t.bal; });
                let eligibleGraphAcc = tAcc.filter(t => ['offset', 'rev', 'revred'].includes(t.type) && t.bal > 0).sort((a,b) => b.trueRate - a.trueRate);
                tAcc.forEach(t => t.appliedBuf = 0);
                for (let rt of eligibleGraphAcc) {
                    if (bufAcc <= 0) break; 
                    let applied = Math.min(bufAcc, rt.bal); 
                    rt.appliedBuf = applied;
                    bufAcc -= applied;
                }
                tAcc.forEach(t => { 
                    t.netBal = t.bal - t.appliedBuf; 
                    if (['rev', 'revred'].includes(t.type)) {
                        currentAccGraphVal += t.netBal; 
                    } else {
                        currentAccGraphVal += t.bal; 
                    }
                });

                if (currentStdGraphVal <= 0.01 && !stdHasHitZero) { stdFinishedGlobalPeriod = p; stdHasHitZero = true; }
                if (currentAccGraphVal <= 0.01 && !accHasHitZero) { accFinishedGlobalPeriod = p; accHasHitZero = true; }

                if (p % freq === 0 || p === 1) {
                    if (p === 1) { 
                        chartLabels.push("Start"); chartStd.push(currentStdGraphVal); chartAcc.push(currentAccGraphVal);
                    } else { 
                        chartLabels.push("Year " + (p/freq)); chartStd.push(currentStdGraphVal); chartAcc.push(currentAccGraphVal); 
                    }
                }

                let availableOffsetStd = globalOffsetBalForGraph; 
                tStd.forEach(t => t.effBal = Math.max(0, t.bal));
                let eligibleStdForInt = tStd.filter(t => ['offset', 'rev', 'revred'].includes(t.type) && t.bal > 0).sort((a,b) => b.trueRate - a.trueRate);
                for (let et of eligibleStdForInt) {
                    if (availableOffsetStd <= 0) break;
                    if (availableOffsetStd >= et.effBal) { availableOffsetStd -= et.effBal; et.effBal = 0; } 
                    else { et.effBal -= availableOffsetStd; availableOffsetStd = 0; }
                }

                let stdMinReqSumStep = 0;

                for(let t of tStd) {
                    if(t.bal <= 0.01) { 
                        t.bal = 0;
                        t.passedGlobalPeriods++;
                        let passedYears = t.passedGlobalPeriods / freq;
                        if (passedYears <= t.tTerm) {
                            let isRealIO = t.type === 'io' && passedYears <= t.ioYears;
                            let inIO = isRealIO || t.type === 'rev';
                            let stepReqPmt = 0;
                            if (t.type === 'rev') stepReqPmt = 0;
                            else if (t.type === 'revred') {
                                let limitDrop = t.amount / (t.tTerm * freq);
                                stepReqPmt = limitDrop;
                            }
                            else stepReqPmt = inIO ? (t.annIo / freq) : (t.annPi / freq);
                            
                            if (isNaN(stepReqPmt) || !isFinite(stepReqPmt)) stepReqPmt = 0;
                            stdMinReqSumStep += stepReqPmt;
                        }
                        continue; 
                    }
                    
                    t.passedGlobalPeriods++; 
                    let passedYears = t.passedGlobalPeriods / freq;
                    let isRealIO = t.type === 'io' && passedYears <= t.ioYears; 
                    let inIO = isRealIO || t.type === 'rev';
                    
                    let stepInt = t.netBal * ((t.trueRate * t.tFreq) / freq); 
                    if (isNaN(stepInt)) stepInt = 0;
                    totalInterestStd += stepInt;
                    
                    let stepReqPmt = 0;
                    if (passedYears <= t.tTerm) {
                        if (t.type === 'rev') { 
                            stepReqPmt = stepInt; 
                        } else if (t.type === 'revred') {
                            let limitDrop = t.amount / (t.tTerm * freq);
                            let currentLimit = t.amount - limitDrop * t.passedGlobalPeriods;
                            let forcedPrincipal = Math.max(0, t.netBal - currentLimit);
                            stepReqPmt = stepInt + forcedPrincipal;
                        } else { 
                            stepReqPmt = inIO ? (t.annIo / freq) : (t.annPi / freq); 
                        }
                    }
                    if (isNaN(stepReqPmt)) stepReqPmt = 0;
                    
                    let principalPaid = Math.max(0, stepReqPmt - stepInt);
                    t.bal -= Math.min(t.bal, principalPaid);
                    
                    stdMinReqSumStep += stepReqPmt;
                }

                let activeAccTranches = tAcc.filter(t => t.bal > 0.01 || t.passedGlobalPeriods < (t.tTerm * freq)); 
                if(activeAccTranches.length > 0) {
                    let accMinReqSumStep = 0; 
                    let snowballCashStep = 0; 
                    let eligibleForExtra = [];

                    for(let t of activeAccTranches) {
                        if(t.bal <= 0.01) {
                            t.bal = 0;
                            t.passedGlobalPeriods++;
                            let passedYears = t.passedGlobalPeriods / freq;
                            if (passedYears <= t.tTerm) {
                                let isRealIO = t.type === 'io' && passedYears <= t.ioYears;
                                let inIO = isRealIO || t.type === 'rev';
                                let stepReqPmt = 0;
                                if (t.type === 'rev') stepReqPmt = 0;
                                else if (t.type === 'revred') {
                                    let limitDrop = t.amount / (t.tTerm * freq);
                                    stepReqPmt = limitDrop;
                                }
                                else stepReqPmt = inIO ? (t.annIo / freq) : (t.annPi / freq);
                                
                                if (isNaN(stepReqPmt) || !isFinite(stepReqPmt)) stepReqPmt = 0;

                                accMinReqSumStep += stepReqPmt;
                                snowballCashStep += stepReqPmt;
                            }
                            continue;
                        }

                        t.passedGlobalPeriods++; 
                        let passedYears = t.passedGlobalPeriods / freq;
                        if (passedYears > t.tTerm) continue;

                        let isRealIO = t.type === 'io' && passedYears <= t.ioYears; 
                        let inIO = isRealIO || t.type === 'rev';
                        
                        let stepInt = 0;
                        if (t.bal > 0) {
                            stepInt = t.netBal * ((t.trueRate * t.tFreq) / freq); 
                            if (isNaN(stepInt)) stepInt = 0;
                            totalInterestAcc += stepInt;
                        }
                        
                        let stepReqPmt = 0;
                        if (t.type === 'rev') { 
                            stepReqPmt = stepInt; 
                        } else if (t.type === 'revred') {
                            let limitDrop = t.amount / (t.tTerm * freq);
                            let currentLimit = t.amount - limitDrop * t.passedGlobalPeriods;
                            let forcedPrincipal = Math.max(0, t.netBal - currentLimit);
                            stepReqPmt = stepInt + forcedPrincipal;
                        } else { 
                            stepReqPmt = inIO ? (t.annIo / freq) : (t.annPi / freq); 
                        }
                        
                        if (isNaN(stepReqPmt)) stepReqPmt = 0;

                        if (t.bal > 0) {
                            let principalPaid = Math.max(0, stepReqPmt - stepInt);
                            let actualPrincipalPaid = Math.min(t.bal, principalPaid);
                            t.bal -= actualPrincipalPaid;
                            
                            let leftoverFromReq = principalPaid - actualPrincipalPaid;
                            if (leftoverFromReq > 0) snowballCashStep += leftoverFromReq;
                            
                            if (!isRealIO) eligibleForExtra.push(t);
                        } else {
                            snowballCashStep += stepReqPmt;
                        }
                        
                        accMinReqSumStep += stepReqPmt;
                    }

                    let currentExtraStep = eligibleForExtra.length > 0 ? globalExtraPerPeriod : 0;
                    
                    let targetTotalCashStep = Math.max(accMinReqSumStep, stdMinReqSumStep) + currentExtraStep;
                    let leftoverCashStep = targetTotalCashStep - accMinReqSumStep + snowballCashStep;
                    
                    if (leftoverCashStep > 0 && eligibleForExtra.length > 0) {
                        eligibleForExtra.sort((a, b) => {
                            let rateA = a.netBal > 0.01 ? a.trueRate : 0;
                            let rateB = b.netBal > 0.01 ? b.trueRate : 0;
                            if (rateB === rateA) return b.trueRate - a.trueRate;
                            return rateB - rateA;
                        });
                        for(let t of eligibleForExtra) {
                            if(leftoverCashStep <= 0 || t.bal <= 0.01) break;
                            if (leftoverCashStep >= t.bal) { leftoverCashStep -= t.bal; t.bal = 0; } 
                            else { t.bal -= leftoverCashStep; leftoverCashStep = 0; }
                        }
                    }
                }
            }
            
            let hasEligibleInPhase1 = validCalcTranches.some(t => !(t.type === 'io' && t.ioYears > 0));
            let appliedExtraPhase1 = hasEligibleInPhase1 ? globalExtraPerPeriod : 0;
            let displayPhase1Payment = finalMinPayment + appliedExtraPhase1;

            repDisplay.innerText = formatMoney(displayPhase1Payment);
            stickyVal.innerText = formatMoney(displayPhase1Payment);
            
            if (globalExtraPerPeriod > 0) {
                document.getElementById('minRepaymentDisplay').innerText = `Minimum: ${formatMoney(finalMinPayment)}`;
                document.getElementById('minRepaymentDisplay').style.display = "block";
                document.getElementById('stickyMinValue').innerText = `(Min: ${formatMoney(finalMinPayment)})`;
                document.getElementById('stickyMinValue').style.display = "block";
            } else {
                document.getElementById('minRepaymentDisplay').style.display = "none";
                document.getElementById('stickyMinValue').style.display = "none";
            }

            if(ioView.classList.contains('active')) {
                document.getElementById('ioPaymentDisplay').innerText = formatMoney(displayPhase1Payment); 
                
                let phase2MinPayment = (phase2FuturePaymentAnn / freq) + trueCost;
                let phase2DisplayPayment = phase2MinPayment + globalExtraPerPeriod;

                document.getElementById('futurePaymentDisplay').innerText = formatMoney(phase2DisplayPayment); 
                document.getElementById('ioDurationDisplay').innerText = longestIOPeriod + (longestIOPeriod===1 ? " Year" : " Years");
                
                if (globalExtraPerPeriod > 0) {
                    document.getElementById('ioMinRepaymentDisplay').innerText = `Minimum: ${formatMoney(finalMinPayment)}`;
                    document.getElementById('ioMinRepaymentDisplay').style.display = "block";
                    document.getElementById('futureMinRepaymentDisplay').innerText = `Minimum: ${formatMoney(phase2MinPayment)}`;
                    document.getElementById('futureMinRepaymentDisplay').style.display = "block";
                } else {
                    document.getElementById('ioMinRepaymentDisplay').style.display = "none";
                    document.getElementById('futureMinRepaymentDisplay').style.display = "none";
                }
            }
            
            let savedInt = Math.max(0, totalInterestStd - totalInterestAcc);
            document.getElementById('interestSaved').innerText = formatMoney(savedInt);

            let savedPeriods = stdFinishedGlobalPeriod - accFinishedGlobalPeriod;
            let savedYearsRaw = savedPeriods / freq;
            
            let globalOffsetBal = getRawValue('globalOffsetBal');
            const badge = document.getElementById('savingsBadge');
            if ((globalExtraPerPeriod > 0 || globalOffsetBal > 0) && savedYearsRaw > 0.1) {
                badge.classList.add('visible');
                let ySaved = Math.floor(savedYearsRaw);
                let mSaved = Math.round((savedYearsRaw - ySaved) * 12);
                if (mSaved === 12) { ySaved++; mSaved = 0; }
                badge.innerText = `Save ${ySaved} yr${ySaved!==1?'s':''} ${mSaved > 0 ? mSaved + ' mo' : ''}`;
            } else { badge.classList.remove('visible'); }

            const smartNotice = document.getElementById('smartNotice');
            if (globalExtraPerPeriod > 0 || globalOffsetBal > 0) {
                let noticeText = ""; let isWarn = false;
                if (complexity === 'simple') { noticeText = `<strong>Smart Payoff Active:</strong> Extra payments are aggressively reducing your principal.`; } 
                else {
                    const hasFixedIO = validCalcTranches.some(t => t.type === 'io');
                    const hasEligible = validCalcTranches.some(t => t.type !== 'io');
                    const maxIoYears = Math.max(...validCalcTranches.map(t => t.type === 'io' ? (t.ioYears||0) : 0));
                    const isMultiple = validCalcTranches.length > 1;

                    if (hasFixedIO && !hasEligible) {
                        isWarn = true; noticeText = `<strong>Note:</strong> Extra repayments wait until your ${maxIoYears}-year IO period ends.`;
                    } else if (hasFixedIO && hasEligible) { noticeText = `<strong>Smart Payoff Active:</strong> Extra payments attack your eligible splits first, and will auto-target your IO splits once their periods end.`;
                    } else if (!hasFixedIO && isMultiple) { noticeText = `<strong>Smart Payoff Active:</strong> Extra payments are optimally applied to your highest interest rate split first.`;
                    } else { noticeText = `<strong>Smart Payoff Active:</strong> Extra payments are aggressively reducing your principal.`; }
                }
                
                if (smartNotice.innerHTML !== noticeText || !smartNotice.classList.contains('visible')) {
                    smartNotice.innerHTML = noticeText;
                    smartNotice.className = isWarn ? 'smart-notice warn-style visible' : 'smart-notice visible';
                    smartNotice.style.animation = 'none'; void smartNotice.offsetWidth; smartNotice.style.animation = 'hlfFadeIn 0.3s ease forwards';
                }
            } else { smartNotice.classList.remove('visible'); }

            const safeStd = chartStd.map(v => (isNaN(v) || !isFinite(v)) ? 0 : Math.max(0, v));
            const safeAcc = chartAcc.map(v => (isNaN(v) || !isFinite(v)) ? 0 : Math.max(0, v));
            updateChart(chartLabels, safeStd, safeAcc);
            
            const revExplainer = document.getElementById('revExplainer');
            const hasRev = validCalcTranches.some(t => t.type === 'rev' || t.type === 'revred');
            if (revExplainer) { revExplainer.style.display = hasRev ? 'block' : 'none'; }
            
            updateURLParams();
        } catch (e) { console.error("Calculation Error:", e); }
    }

    function updateChart(labels, standardData, acceleratedData) {
        if (typeof Chart === 'undefined') {
            setTimeout(() => updateChart(labels, standardData, acceleratedData), 100);
            return;
        }
        const canvas = document.getElementById('loanChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (loanChart) {
            loanChart.data.labels = labels;
            loanChart.data.datasets[0].data = standardData;
            loanChart.data.datasets[1].data = acceleratedData;
            loanChart.update('none'); 
        } else {
            loanChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Standard', data: standardData, borderColor: '#1F2023', borderWidth: 2, pointRadius: 0, pointHitRadius: 20, tension: 0.1 },
                        { label: 'With Target', data: acceleratedData, borderColor: '#61A0FF', backgroundColor: 'rgba(97, 160, 255, 0.10)', borderWidth: 3, pointRadius: 0, pointHitRadius: 20, fill: true, tension: 0.1 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, layout: { padding: { right: 20, left: 0 } }, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1F2023', titleColor: '#61A0FF', callbacks: { label: function(context) { return context.dataset.label + ': ' + formatMoney(context.parsed.y); } } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: {size: 10}, autoSkip: true, includeBounds: true } }, y: { grid: { color: '#EDEEEF' }, ticks: { callback: val => '$' + val/1000 + 'k', font: {size: 10} }, beginAtZero: true } } }
            });
        }
    }

    function calculate() { runFullCalculation(); }
    window.addEventListener('DOMContentLoaded', () => { attachCurrencyListeners(); loadParamsFromURL(); });

